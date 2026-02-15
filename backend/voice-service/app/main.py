import os
import tempfile
from typing import Optional
import base64
import json
import logging
import time
import uuid
from collections import defaultdict, deque
from threading import Lock

from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi import WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, generate_latest
from pydantic import BaseModel

try:
    from faster_whisper import WhisperModel
except ImportError:  # pragma: no cover
    WhisperModel = None


class TranscriptionResponse(BaseModel):
    text: str
    confidence: float


app = FastAPI(title="Voice Transcription Service", version="0.1.0")
logger = logging.getLogger("voice-service")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


class MetricsAccessFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        return "GET /metrics " not in message and "GET /metrics/json " not in message


logging.getLogger("uvicorn.access").addFilter(MetricsAccessFilter())

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ALLOW_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_model: Optional["WhisperModel"] = None
_metrics_lock = Lock()
_rate_limit_lock = Lock()
_active_ws_lock = Lock()

VOICE_API_KEY = os.getenv("VOICE_API_KEY")
MAX_AUDIO_BYTES = int(os.getenv("MAX_AUDIO_BYTES", "2000000"))
ALLOWED_MIME_TYPES = {
    mime.strip() for mime in os.getenv(
        "ALLOWED_AUDIO_MIME_TYPES",
        "audio/webm,audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/ogg",
    ).split(",")
}
HTTP_RATE_LIMIT_WINDOW_SEC = int(os.getenv("HTTP_RATE_LIMIT_WINDOW_SEC", "60"))
HTTP_RATE_LIMIT_MAX = int(os.getenv("HTTP_RATE_LIMIT_MAX", "120"))
WS_RATE_LIMIT_WINDOW_SEC = int(os.getenv("WS_RATE_LIMIT_WINDOW_SEC", "10"))
WS_RATE_LIMIT_MAX = int(os.getenv("WS_RATE_LIMIT_MAX", "40"))
WS_MAX_SESSION_SECONDS = int(os.getenv("WS_MAX_SESSION_SECONDS", "300"))
WS_MAX_CHUNKS = int(os.getenv("WS_MAX_CHUNKS", "120"))
WS_PARTIAL_EVERY_CHUNKS = int(os.getenv("WS_PARTIAL_EVERY_CHUNKS", "3"))
MAX_CONCURRENT_WS = int(os.getenv("MAX_CONCURRENT_WS", "20"))
WHISPER_VAD_FILTER = os.getenv("WHISPER_VAD_FILTER", "false").lower() == "true"
VOICE_TRACE = os.getenv("VOICE_TRACE", "false").lower() == "true"

_http_rate_events: dict[str, deque[float]] = defaultdict(deque)
_ws_rate_events: dict[str, deque[float]] = defaultdict(deque)
_active_ws_sessions: set[str] = set()
_metrics = {
    "http_requests_total": 0,
    "http_errors_total": 0,
    "ws_connections_total": 0,
    "ws_errors_total": 0,
    "transcriptions_total": 0,
    "transcription_errors_total": 0,
    "rate_limited_total": 0,
}

PROM_HTTP_REQUESTS_TOTAL = Counter("voice_http_requests_total", "Total HTTP transcription requests")
PROM_HTTP_ERRORS_TOTAL = Counter("voice_http_errors_total", "Total HTTP errors")
PROM_WS_CONNECTIONS_TOTAL = Counter("voice_ws_connections_total", "Total WebSocket connections")
PROM_WS_ERRORS_TOTAL = Counter("voice_ws_errors_total", "Total WebSocket errors")
PROM_TRANSCRIPTIONS_TOTAL = Counter("voice_transcriptions_total", "Total successful transcriptions")
PROM_TRANSCRIPTION_ERRORS_TOTAL = Counter("voice_transcription_errors_total", "Total transcription failures")
PROM_RATE_LIMITED_TOTAL = Counter("voice_rate_limited_total", "Total rate-limited events")
PROM_ACTIVE_WS_SESSIONS = Gauge("voice_active_ws_sessions", "Current active WebSocket sessions")


def _inc_metric(name: str, delta: int = 1) -> None:
    with _metrics_lock:
        _metrics[name] = _metrics.get(name, 0) + delta
    if name == "http_requests_total":
        PROM_HTTP_REQUESTS_TOTAL.inc(delta)
    elif name == "http_errors_total":
        PROM_HTTP_ERRORS_TOTAL.inc(delta)
    elif name == "ws_connections_total":
        PROM_WS_CONNECTIONS_TOTAL.inc(delta)
    elif name == "ws_errors_total":
        PROM_WS_ERRORS_TOTAL.inc(delta)
    elif name == "transcriptions_total":
        PROM_TRANSCRIPTIONS_TOTAL.inc(delta)
    elif name == "transcription_errors_total":
        PROM_TRANSCRIPTION_ERRORS_TOTAL.inc(delta)
    elif name == "rate_limited_total":
        PROM_RATE_LIMITED_TOTAL.inc(delta)


def _enforce_api_key(authorization: Optional[str], api_key: Optional[str]) -> None:
    if not VOICE_API_KEY:
        return

    bearer = ""
    if authorization:
        parts = authorization.split(" ", 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            bearer = parts[1]

    candidate = bearer or (api_key or "")
    if candidate != VOICE_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _rate_limited(
    buckets: dict[str, deque[float]],
    key: str,
    *,
    window_seconds: int,
    max_events: int,
) -> bool:
    now = time.time()
    with _rate_limit_lock:
        queue = buckets[key]
        while queue and now - queue[0] > window_seconds:
            queue.popleft()
        if len(queue) >= max_events:
            return True
        queue.append(now)
    return False


def get_whisper_model() -> "WhisperModel":
    global _model
    if WhisperModel is None:
        raise HTTPException(
            status_code=500,
            detail="faster-whisper is not installed on the backend.",
        )

    if _model is None:
        model_size = os.getenv("WHISPER_MODEL", "base")
        device = os.getenv("WHISPER_DEVICE", "cpu")
        compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
        _model = WhisperModel(model_size, device=device, compute_type=compute_type)
    return _model


def _mime_to_suffix(mime_type: str) -> str:
    mapping = {
        "audio/webm": ".webm",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/mpeg": ".mp3",
        "audio/mp4": ".m4a",
        "audio/ogg": ".ogg",
    }
    return mapping.get(mime_type, ".webm")


def _normalize_mime_type(mime_type: str) -> str:
    return mime_type.split(";", 1)[0].strip().lower()


def _transcribe_bytes(contents: bytes, suffix: str) -> TranscriptionResponse:
    if not contents:
        raise HTTPException(status_code=400, detail="Empty audio file.")
    if len(contents) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio payload exceeds configured size limit.")

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_audio:
        temp_audio.write(contents)
        temp_path = temp_audio.name

    try:
        started = time.perf_counter()
        model = get_whisper_model()
        language = os.getenv("WHISPER_LANGUAGE", "en")

        segments, info = model.transcribe(
            temp_path,
            language=language,
            vad_filter=WHISPER_VAD_FILTER,
            beam_size=1,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        avg_logprob = float(getattr(info, "avg_logprob", -1.0))
        confidence = max(0.0, min(1.0, avg_logprob + 1.0))
        if text and confidence == 0.0:
            # Some faster-whisper responses may not expose avg_logprob reliably
            # for short command audio; return a neutral confidence instead of zero.
            confidence = 0.65
        _inc_metric("transcriptions_total")
        if VOICE_TRACE:
            logger.info(
                "voice_trace_transcribe size=%s suffix=%s text_len=%s confidence=%.3f duration_ms=%s",
                len(contents),
                suffix,
                len(text),
                confidence,
                int((time.perf_counter() - started) * 1000),
            )
        return TranscriptionResponse(text=text, confidence=confidence)
    except HTTPException:
        _inc_metric("transcription_errors_total")
        raise
    except Exception as error:  # pragma: no cover
        _inc_metric("transcription_errors_total")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {error}") from error
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/metrics")
def metrics() -> Response:
    with _active_ws_lock:
        PROM_ACTIVE_WS_SESSIONS.set(len(_active_ws_sessions))
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/metrics/json")
def metrics_json() -> dict[str, int]:
    with _metrics_lock:
        snapshot = dict(_metrics)
    with _active_ws_lock:
        snapshot["active_ws_sessions"] = len(_active_ws_sessions)
    return snapshot


@app.post("/api/transcribe/{engine}", response_model=TranscriptionResponse)
async def transcribe(
    engine: str,
    request: Request,
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(default=None),
    x_api_key: Optional[str] = Header(default=None),
) -> TranscriptionResponse:
    _inc_metric("http_requests_total")
    _enforce_api_key(authorization, x_api_key)

    client_ip = request.client.host if request.client else "unknown"
    if _rate_limited(
        _http_rate_events,
        f"http:{client_ip}",
        window_seconds=HTTP_RATE_LIMIT_WINDOW_SEC,
        max_events=HTTP_RATE_LIMIT_MAX,
    ):
        _inc_metric("rate_limited_total")
        _inc_metric("http_errors_total")
        raise HTTPException(status_code=429, detail="Too many requests. Please retry later.")

    if engine != "whisper":
        _inc_metric("http_errors_total")
        raise HTTPException(status_code=501, detail=f"Engine '{engine}' is not implemented.")
    normalized_mime = _normalize_mime_type(file.content_type or "")
    if normalized_mime not in ALLOWED_MIME_TYPES:
        _inc_metric("http_errors_total")
        raise HTTPException(status_code=415, detail=f"Unsupported audio mime type: {file.content_type}")

    contents = await file.read()
    if VOICE_TRACE:
        logger.info(
            "voice_trace_http_request engine=%s mime=%s size=%s client=%s",
            engine,
            normalized_mime,
            len(contents),
            client_ip,
        )
    suffix = _mime_to_suffix(normalized_mime)
    try:
        return _transcribe_bytes(contents, suffix)
    except HTTPException:
        _inc_metric("http_errors_total")
        raise


@app.websocket("/api/voice/ws")
async def transcribe_websocket(websocket: WebSocket) -> None:
    session_id = websocket.query_params.get("sessionId", str(uuid.uuid4()))
    client_ip = websocket.client.host if websocket.client else "unknown"

    with _active_ws_lock:
        if len(_active_ws_sessions) >= MAX_CONCURRENT_WS:
            await websocket.accept()
            await websocket.send_json({"type": "error", "message": "Service is at capacity. Try again shortly."})
            await websocket.close(code=1013)
            _inc_metric("ws_errors_total")
            return
        _active_ws_sessions.add(session_id)
        PROM_ACTIVE_WS_SESSIONS.set(len(_active_ws_sessions))

    await websocket.accept()
    _inc_metric("ws_connections_total")
    if VOICE_TRACE:
        logger.info("voice_trace_ws_open session_id=%s client=%s", session_id, client_ip)

    try:
        _enforce_api_key(
            websocket.headers.get("authorization"),
            websocket.query_params.get("token") or websocket.headers.get("x-api-key"),
        )
    except HTTPException:
        await websocket.send_json({"type": "error", "message": "Unauthorized"})
        await websocket.close(code=1008)
        _inc_metric("ws_errors_total")
        with _active_ws_lock:
            _active_ws_sessions.discard(session_id)
            PROM_ACTIVE_WS_SESSIONS.set(len(_active_ws_sessions))
        return

    engine = websocket.query_params.get("engine", "whisper")
    if engine != "whisper":
        await websocket.send_json({"type": "error", "message": f"Engine '{engine}' is not implemented."})
        await websocket.close(code=1003)
        _inc_metric("ws_errors_total")
        with _active_ws_lock:
            _active_ws_sessions.discard(session_id)
            PROM_ACTIVE_WS_SESSIONS.set(len(_active_ws_sessions))
        return

    await websocket.send_json({"type": "ready"})
    transcript_parts: list[str] = []
    session_suffix = ".webm"
    last_partial_text = ""
    last_confidence = 0.0
    session_started_at = time.time()
    chunks_processed = 0

    try:
        while True:
            if time.time() - session_started_at > WS_MAX_SESSION_SECONDS:
                await websocket.send_json({"type": "error", "message": "Session timeout exceeded."})
                await websocket.close(code=1000)
                return

            if _rate_limited(
                _ws_rate_events,
                f"ws:{client_ip}",
                window_seconds=WS_RATE_LIMIT_WINDOW_SEC,
                max_events=WS_RATE_LIMIT_MAX,
            ):
                _inc_metric("rate_limited_total")
                await websocket.send_json({"type": "error", "message": "WebSocket rate limit exceeded."})
                await websocket.close(code=1008)
                return

            raw_message = await websocket.receive_text()
            message = json.loads(raw_message)
            message_type = message.get("type")

            if message_type == "start":
                continue

            if message_type == "audio_chunk":
                payload = message.get("payload")
                if not payload:
                    continue

                try:
                    audio_bytes = base64.b64decode(payload, validate=True)
                except Exception:
                    await websocket.send_json({"type": "error", "message": "Invalid audio payload."})
                    continue

                mime_type = message.get("mimeType", "audio/webm")
                normalized_mime = _normalize_mime_type(mime_type)
                if normalized_mime not in ALLOWED_MIME_TYPES:
                    await websocket.send_json({"type": "error", "message": f"Unsupported mime type: {mime_type}"})
                    continue
                if len(audio_bytes) > MAX_AUDIO_BYTES:
                    await websocket.send_json({"type": "error", "message": "Audio chunk too large."})
                    continue
                chunks_processed += 1
                if VOICE_TRACE and (chunks_processed == 1 or chunks_processed % 10 == 0):
                    logger.info(
                        "voice_trace_ws_chunk session_id=%s chunk=%s size=%s mime=%s",
                        session_id,
                        chunks_processed,
                        len(audio_bytes),
                        normalized_mime,
                    )
                if chunks_processed > WS_MAX_CHUNKS:
                    await websocket.send_json({"type": "error", "message": "Session chunk limit reached."})
                    await websocket.close(code=1000)
                    return

                session_suffix = _mime_to_suffix(normalized_mime)

                # Transcribe chunk-by-chunk to avoid concatenation issues with
                # containerized formats (e.g. webm/ogg chunk boundaries).
                try:
                    chunk_result = _transcribe_bytes(audio_bytes, session_suffix)
                    chunk_text = chunk_result.text.strip()
                    if chunk_text:
                        if not transcript_parts or transcript_parts[-1] != chunk_text:
                            transcript_parts.append(chunk_text)
                        last_confidence = chunk_result.confidence
                except HTTPException:
                    # Some chunks are undecodable in isolation; keep the stream alive.
                    pass

                if chunks_processed % WS_PARTIAL_EVERY_CHUNKS == 0 and transcript_parts:
                    partial_text = " ".join(transcript_parts).strip()
                    if partial_text and partial_text != last_partial_text:
                        last_partial_text = partial_text
                        if VOICE_TRACE:
                            logger.info(
                                "voice_trace_ws_partial session_id=%s text_len=%s",
                                session_id,
                                len(partial_text),
                            )
                        await websocket.send_json(
                            {
                                "type": "partial_transcript",
                                "text": partial_text,
                                "confidence": last_confidence,
                            }
                        )
                continue

            if message_type == "stop":
                final_text = ""
                final_confidence = 0.0

                if transcript_parts:
                    final_text = " ".join(transcript_parts).strip()
                    final_confidence = last_confidence
                elif last_partial_text:
                    final_text = last_partial_text
                    final_confidence = 1.0

                await websocket.send_json(
                    {
                        "type": "final_transcript",
                        "text": final_text,
                        "confidence": final_confidence,
                    }
                )
                if VOICE_TRACE:
                    logger.info(
                        "voice_trace_ws_final session_id=%s text_len=%s confidence=%.3f chunks=%s",
                        session_id,
                        len(final_text),
                        final_confidence,
                        chunks_processed,
                    )
                await websocket.send_json(
                    {"type": "session_summary", "chunks": len(transcript_parts)}
                )
                logger.info("voice_ws_session_complete session_id=%s client=%s chunks=%s", session_id, client_ip, chunks_processed)
                await websocket.close()
                return

            await websocket.send_json({"type": "error", "message": f"Unknown message type: {message_type}"})
    except WebSocketDisconnect:
        logger.info("voice_ws_disconnected session_id=%s client=%s", session_id, client_ip)
        return
    except Exception as error:
        _inc_metric("ws_errors_total")
        logger.exception("voice_ws_error session_id=%s client=%s", session_id, client_ip)
        await websocket.send_json({"type": "error", "message": f"WebSocket transcription failed: {error}"})
        await websocket.close(code=1011)
    finally:
        with _active_ws_lock:
            _active_ws_sessions.discard(session_id)
            PROM_ACTIVE_WS_SESSIONS.set(len(_active_ws_sessions))
