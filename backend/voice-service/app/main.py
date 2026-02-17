import os
import tempfile
from typing import Optional
import base64
import json
import logging
import time
import uuid
import subprocess
import shutil
import sys
import difflib
from collections import defaultdict, deque
from threading import Lock

from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi import WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from pydantic import BaseModel

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LOCAL_DEPS_PATH = os.path.join(PROJECT_ROOT, ".deps")
if os.path.isdir(LOCAL_DEPS_PATH) and LOCAL_DEPS_PATH not in sys.path:
    sys.path.insert(0, LOCAL_DEPS_PATH)

try:
    from faster_whisper import WhisperModel
except ImportError:  # pragma: no cover
    WhisperModel = None

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None

try:
    import imageio_ffmpeg  # type: ignore
except ImportError:  # pragma: no cover
    imageio_ffmpeg = None


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
_tuning_lock = Lock()

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
WS_PIPELINE_MODE = os.getenv("WS_PIPELINE_MODE", "hybrid").strip().lower()
WS_AUDIO_SAMPLE_RATE = int(os.getenv("WS_AUDIO_SAMPLE_RATE", "16000"))
WS_PARTIAL_WINDOW_MS = int(os.getenv("WS_PARTIAL_WINDOW_MS", "2200"))
WS_OVERLAP_MS = int(os.getenv("WS_OVERLAP_MS", "400"))
WS_ENABLE_NS = os.getenv("WS_ENABLE_NS", "true").lower() == "true"
WS_NS_ATTENUATION = float(os.getenv("WS_NS_ATTENUATION", "0.2"))
WS_VAD_START_RMS = float(os.getenv("WS_VAD_START_RMS", "0.015"))
WS_VAD_END_RMS = float(os.getenv("WS_VAD_END_RMS", "0.010"))
WS_VAD_HANGOVER_CHUNKS = int(os.getenv("WS_VAD_HANGOVER_CHUNKS", "2"))
WS_PARTIAL_BEAM_SIZE = int(os.getenv("WS_PARTIAL_BEAM_SIZE", "1"))
WS_FINAL_BEAM_SIZE = int(os.getenv("WS_FINAL_BEAM_SIZE", "5"))
WS_FINAL_VAD_FILTER = os.getenv("WS_FINAL_VAD_FILTER", "true").lower() == "true"
WS_TUNING_WINDOW_SESSIONS = int(os.getenv("WS_TUNING_WINDOW_SESSIONS", "100"))
WS_TUNING_REPORT_EVERY_SESSIONS = int(os.getenv("WS_TUNING_REPORT_EVERY_SESSIONS", "20"))
WS_TARGET_PARTIAL_LATENCY_MS = float(os.getenv("WS_TARGET_PARTIAL_LATENCY_MS", "900"))
WS_TARGET_FINAL_LATENCY_MS = float(os.getenv("WS_TARGET_FINAL_LATENCY_MS", "1700"))
WS_TARGET_DIVERGENCE_RATIO = float(os.getenv("WS_TARGET_DIVERGENCE_RATIO", "0.40"))
FFMPEG_BINARY = shutil.which("ffmpeg")
if FFMPEG_BINARY is None and imageio_ffmpeg is not None:
    try:
        FFMPEG_BINARY = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        FFMPEG_BINARY = None
WS_HYBRID_READY = np is not None and FFMPEG_BINARY is not None

_http_rate_events: dict[str, deque[float]] = defaultdict(deque)
_ws_rate_events: dict[str, deque[float]] = defaultdict(deque)
_active_ws_sessions: set[str] = set()
_tuning_recent_sessions: deque[dict[str, float]] = deque(maxlen=WS_TUNING_WINDOW_SESSIONS)
_tuning_sessions_total = 0
_metrics = {
    "http_requests_total": 0,
    "http_errors_total": 0,
    "ws_connections_total": 0,
    "ws_errors_total": 0,
    "transcriptions_total": 0,
    "transcription_errors_total": 0,
    "rate_limited_total": 0,
    "ws_decode_fallback_total": 0,
    "ws_partials_emitted_total": 0,
    "ws_finals_emitted_total": 0,
}

PROM_HTTP_REQUESTS_TOTAL = Counter("voice_http_requests_total", "Total HTTP transcription requests")
PROM_HTTP_ERRORS_TOTAL = Counter("voice_http_errors_total", "Total HTTP errors")
PROM_WS_CONNECTIONS_TOTAL = Counter("voice_ws_connections_total", "Total WebSocket connections")
PROM_WS_ERRORS_TOTAL = Counter("voice_ws_errors_total", "Total WebSocket errors")
PROM_TRANSCRIPTIONS_TOTAL = Counter("voice_transcriptions_total", "Total successful transcriptions")
PROM_TRANSCRIPTION_ERRORS_TOTAL = Counter("voice_transcription_errors_total", "Total transcription failures")
PROM_RATE_LIMITED_TOTAL = Counter("voice_rate_limited_total", "Total rate-limited events")
PROM_ACTIVE_WS_SESSIONS = Gauge("voice_active_ws_sessions", "Current active WebSocket sessions")
PROM_WS_DECODE_FALLBACK_TOTAL = Counter(
    "voice_ws_decode_fallback_total",
    "Total hybrid decode fallbacks",
    ["reason"],
)
PROM_WS_PARTIAL_LATENCY_MS = Histogram(
    "voice_ws_partial_latency_ms",
    "Partial transcript latency in milliseconds",
    buckets=(100, 200, 300, 400, 600, 800, 1000, 1400, 1800, 2400, 3200, 5000),
)
PROM_WS_FINAL_LATENCY_MS = Histogram(
    "voice_ws_final_latency_ms",
    "Final transcript latency in milliseconds",
    buckets=(200, 400, 600, 900, 1200, 1600, 2200, 3000, 4500, 6500, 9000),
)
PROM_WS_PARTIAL_FINAL_DIVERGENCE = Histogram(
    "voice_ws_partial_final_divergence_ratio",
    "Divergence ratio between latest partial and finalized transcript",
    buckets=(0.0, 0.05, 0.1, 0.15, 0.25, 0.35, 0.45, 0.60, 0.80, 1.0),
)


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
    elif name == "ws_partials_emitted_total":
        pass
    elif name == "ws_finals_emitted_total":
        pass


def _record_decode_fallback(reason: str) -> None:
    _inc_metric("ws_decode_fallback_total")
    PROM_WS_DECODE_FALLBACK_TOTAL.labels(reason=reason).inc()


def _transcript_divergence_ratio(partial_text: str, final_text: str) -> float:
    if not partial_text and not final_text:
        return 0.0
    ratio = difflib.SequenceMatcher(None, partial_text.strip(), final_text.strip()).ratio()
    return max(0.0, min(1.0, 1.0 - float(ratio)))


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    mid = len(sorted_values) // 2
    if len(sorted_values) % 2 == 1:
        return float(sorted_values[mid])
    return float((sorted_values[mid - 1] + sorted_values[mid]) / 2.0)


def _quantile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    if q <= 0:
        return float(min(values))
    if q >= 1:
        return float(max(values))
    sorted_values = sorted(values)
    idx = int(round((len(sorted_values) - 1) * q))
    return float(sorted_values[idx])


def _report_tuning_window_if_needed(
    *,
    session_id: str,
    partial_latency_ms: float,
    final_latency_ms: float,
    divergence_ratio: float,
    decode_fallbacks: float,
) -> None:
    global _tuning_sessions_total
    with _tuning_lock:
        _tuning_recent_sessions.append(
            {
                "partial_latency_ms": partial_latency_ms,
                "final_latency_ms": final_latency_ms,
                "divergence_ratio": divergence_ratio,
                "decode_fallbacks": decode_fallbacks,
            }
        )
        _tuning_sessions_total += 1
        current_total = _tuning_sessions_total
        snapshot = list(_tuning_recent_sessions)

    if not snapshot:
        return
    if WS_TUNING_REPORT_EVERY_SESSIONS <= 0 or current_total % WS_TUNING_REPORT_EVERY_SESSIONS != 0:
        return

    partial_values = [entry["partial_latency_ms"] for entry in snapshot if entry["partial_latency_ms"] > 0]
    final_values = [entry["final_latency_ms"] for entry in snapshot if entry["final_latency_ms"] > 0]
    divergence_values = [entry["divergence_ratio"] for entry in snapshot if entry["divergence_ratio"] >= 0]
    decode_values = [entry["decode_fallbacks"] for entry in snapshot]

    p95_partial = _quantile(partial_values, 0.95) if partial_values else 0.0
    p95_final = _quantile(final_values, 0.95) if final_values else 0.0
    median_divergence = _median(divergence_values) if divergence_values else 0.0
    avg_decode_fallbacks = float(sum(decode_values) / len(decode_values)) if decode_values else 0.0

    suggestions: list[str] = []
    if p95_partial > WS_TARGET_PARTIAL_LATENCY_MS:
        suggestions.append(
            f"reduce WS_OVERLAP_MS (current={WS_OVERLAP_MS}) or WS_PARTIAL_WINDOW_MS (current={WS_PARTIAL_WINDOW_MS})"
        )
    if p95_final > WS_TARGET_FINAL_LATENCY_MS:
        suggestions.append(f"reduce WS_FINAL_BEAM_SIZE (current={WS_FINAL_BEAM_SIZE})")
    if median_divergence > WS_TARGET_DIVERGENCE_RATIO:
        suggestions.append(
            f"raise WS_OVERLAP_MS (current={WS_OVERLAP_MS}) or WS_VAD_HANGOVER_CHUNKS (current={WS_VAD_HANGOVER_CHUNKS})"
        )
    if avg_decode_fallbacks > 0.05:
        suggestions.append("stabilize decode path (ffmpeg availability/chunk codec); hybrid fallbacks are elevated")
    if not suggestions:
        suggestions.append("current WS tuning is within configured staging targets")

    logger.info(
        "voice_tuning_window session_id=%s sessions=%s p95_partial_ms=%.1f p95_final_ms=%.1f median_divergence=%.3f avg_decode_fallbacks=%.3f suggestions=%s",
        session_id,
        len(snapshot),
        p95_partial,
        p95_final,
        median_divergence,
        avg_decode_fallbacks,
        " | ".join(suggestions),
    )


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


def _confidence_from_info(info: object, text: str) -> float:
    avg_logprob = float(getattr(info, "avg_logprob", -1.0))
    confidence = max(0.0, min(1.0, avg_logprob + 1.0))
    if text and confidence == 0.0:
        # Some faster-whisper responses may not expose avg_logprob reliably
        # for short command audio; return a neutral confidence instead of zero.
        confidence = 0.65
    return confidence


def _decode_to_pcm16_mono(audio_bytes: bytes, suffix: str) -> bytes:
    if not audio_bytes:
        return b""

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_input:
        temp_input.write(audio_bytes)
        input_path = temp_input.name
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pcm") as temp_pcm:
        pcm_path = temp_pcm.name

    try:
        ffmpeg_cmd = [
            FFMPEG_BINARY or "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            input_path,
            "-ac",
            "1",
            "-ar",
            str(WS_AUDIO_SAMPLE_RATE),
            "-f",
            "s16le",
            pcm_path,
        ]
        completed = subprocess.run(ffmpeg_cmd, capture_output=True, check=False)
        if completed.returncode != 0:
            stderr = completed.stderr.decode("utf-8", errors="ignore").strip()
            raise ValueError(f"ffmpeg decode failed: {stderr or 'unknown error'}")
        with open(pcm_path, "rb") as pcm_file:
            return pcm_file.read()
    finally:
        for path in (input_path, pcm_path):
            try:
                os.remove(path)
            except OSError:
                pass


def _pcm16_to_float32(samples_bytes: bytes) -> Optional["np.ndarray"]:
    if np is None or not samples_bytes:
        return None
    int16_data = np.frombuffer(samples_bytes, dtype=np.int16)
    if int16_data.size == 0:
        return None
    return int16_data.astype(np.float32) / 32768.0


def _rms(samples: Optional["np.ndarray"]) -> float:
    if np is None or samples is None or samples.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(samples), dtype=np.float32)))


def _light_noise_suppress(samples: Optional["np.ndarray"]) -> Optional["np.ndarray"]:
    if (
        np is None
        or samples is None
        or samples.size < 320
        or not WS_ENABLE_NS
    ):
        return samples

    frame_size = 160  # 10ms at 16kHz.
    usable_len = (samples.size // frame_size) * frame_size
    if usable_len <= 0:
        return samples

    framed = samples[:usable_len].reshape(-1, frame_size)
    frame_rms = np.sqrt(np.mean(np.square(framed), axis=1, dtype=np.float32))
    noise_floor = float(np.percentile(frame_rms, 20))
    gate = max(noise_floor * 1.8, 1e-5)

    gains = np.where(frame_rms >= gate, 1.0, WS_NS_ATTENUATION).astype(np.float32)
    denoised = framed * gains[:, np.newaxis]

    output = samples.copy()
    output[:usable_len] = denoised.reshape(usable_len)
    return output


def _transcribe_samples(
    samples: "np.ndarray",
    *,
    beam_size: int,
    vad_filter: bool,
) -> TranscriptionResponse:
    if np is None or samples.size == 0:
        return TranscriptionResponse(text="", confidence=0.0)

    started = time.perf_counter()
    model = get_whisper_model()
    language = os.getenv("WHISPER_LANGUAGE", "en")
    segments, info = model.transcribe(
        samples,
        language=language,
        vad_filter=vad_filter,
        beam_size=beam_size,
        condition_on_previous_text=False,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    confidence = _confidence_from_info(info, text)
    if text:
        _inc_metric("transcriptions_total")
    if VOICE_TRACE and text:
        logger.info(
            "voice_trace_transcribe_samples samples=%s text_len=%s confidence=%.3f beam=%s vad=%s duration_ms=%s",
            int(samples.size),
            len(text),
            confidence,
            beam_size,
            vad_filter,
            int((time.perf_counter() - started) * 1000),
        )
    return TranscriptionResponse(text=text, confidence=confidence)


class StreamPipelineState:
    def __init__(self) -> None:
        if np is None:
            self.utterance_samples = None
        else:
            self.utterance_samples = np.zeros((0,), dtype=np.float32)
        self.speech_active = False
        self.silence_streak = 0
        self.last_partial_text = ""
        self.last_partial_confidence = 0.0
        self.last_final_text = ""
        self.last_final_confidence = 0.0
        self.partials_emitted = 0
        self.finals_emitted = 0
        self.utterance_started_at = 0.0
        self.partial_latency_ms: list[float] = []
        self.final_latency_ms: list[float] = []
        self.divergence_ratio: list[float] = []
        self.decode_fallbacks = 0

    def append_samples(self, samples: "np.ndarray") -> None:
        if np is None or samples.size == 0 or self.utterance_samples is None:
            return
        if self.utterance_samples.size == 0:
            self.utterance_samples = samples.copy()
            return
        self.utterance_samples = np.concatenate((self.utterance_samples, samples), axis=0)

    def clear_utterance(self) -> None:
        if np is None:
            self.utterance_samples = None
            return
        self.utterance_samples = np.zeros((0,), dtype=np.float32)
        self.speech_active = False
        self.silence_streak = 0
        self.utterance_started_at = 0.0


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
        confidence = _confidence_from_info(info, text)
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

    if WS_PIPELINE_MODE == "hybrid" and not WS_HYBRID_READY:
        logger.warning(
            "voice_ws_hybrid_unavailable session_id=%s reason=%s",
            session_id,
            "numpy_or_ffmpeg_missing",
        )
        _record_decode_fallback("hybrid_unavailable")

    await websocket.send_json({"type": "ready"})
    transcript_parts: list[str] = []
    session_suffix = ".webm"
    last_partial_text = ""
    last_confidence = 0.0
    session_started_at = time.time()
    chunks_processed = 0
    pipeline = StreamPipelineState()
    overlap_samples = max(0, int(WS_AUDIO_SAMPLE_RATE * WS_OVERLAP_MS / 1000))
    partial_window_samples = max(1, int(WS_AUDIO_SAMPLE_RATE * WS_PARTIAL_WINDOW_MS / 1000))
    overlap_tail = np.zeros((0,), dtype=np.float32) if np is not None else None

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

                used_hybrid = False
                if WS_PIPELINE_MODE == "hybrid" and WS_HYBRID_READY:
                    decode_failed = False
                    try:
                        pcm_bytes = _decode_to_pcm16_mono(audio_bytes, session_suffix)
                        chunk_samples = _pcm16_to_float32(pcm_bytes)
                    except Exception as decode_error:
                        _record_decode_fallback("decode_error")
                        pipeline.decode_fallbacks += 1
                        decode_failed = True
                        if VOICE_TRACE:
                            logger.warning(
                                "voice_trace_ws_decode_fallback session_id=%s chunk=%s error=%s",
                                session_id,
                                chunks_processed,
                                decode_error,
                            )
                        chunk_samples = None

                    if not decode_failed and (chunk_samples is None or chunk_samples.size == 0):
                        _record_decode_fallback("empty_pcm")
                        pipeline.decode_fallbacks += 1
                    if chunk_samples is not None and chunk_samples.size > 0:
                        used_hybrid = True
                        prior_overlap = overlap_tail.copy() if overlap_tail is not None else None
                        denoised = _light_noise_suppress(chunk_samples)
                        chunk_rms = _rms(denoised)

                        if not pipeline.speech_active and chunk_rms >= WS_VAD_START_RMS:
                            pipeline.speech_active = True
                            pipeline.silence_streak = 0
                            pipeline.utterance_started_at = time.time()
                            if (
                                prior_overlap is not None
                                and prior_overlap.size > 0
                                and (pipeline.utterance_samples is not None and pipeline.utterance_samples.size == 0)
                            ):
                                pipeline.append_samples(prior_overlap)

                        if pipeline.speech_active and denoised is not None:
                            pipeline.append_samples(denoised)
                            if chunk_rms <= WS_VAD_END_RMS:
                                pipeline.silence_streak += 1
                            else:
                                pipeline.silence_streak = 0

                            if (
                                chunks_processed % WS_PARTIAL_EVERY_CHUNKS == 0
                                and pipeline.utterance_samples is not None
                                and pipeline.utterance_samples.size > 0
                            ):
                                partial_samples = pipeline.utterance_samples[-partial_window_samples:]
                                try:
                                    partial_result = _transcribe_samples(
                                        partial_samples,
                                        beam_size=WS_PARTIAL_BEAM_SIZE,
                                        vad_filter=False,
                                    )
                                    partial_text = partial_result.text.strip()
                                    if partial_text and partial_text != pipeline.last_partial_text:
                                        pipeline.last_partial_text = partial_text
                                        pipeline.last_partial_confidence = partial_result.confidence
                                        pipeline.partials_emitted += 1
                                        _inc_metric("ws_partials_emitted_total")
                                        last_partial_text = partial_text
                                        last_confidence = partial_result.confidence
                                        if pipeline.utterance_started_at > 0:
                                            partial_latency_ms = (time.time() - pipeline.utterance_started_at) * 1000.0
                                            pipeline.partial_latency_ms.append(partial_latency_ms)
                                            PROM_WS_PARTIAL_LATENCY_MS.observe(partial_latency_ms)
                                        await websocket.send_json(
                                            {
                                                "type": "partial_transcript",
                                                "text": partial_text,
                                                "confidence": partial_result.confidence,
                                            }
                                        )
                                except Exception:
                                    if VOICE_TRACE:
                                        logger.exception(
                                            "voice_trace_ws_partial_failed session_id=%s chunk=%s",
                                            session_id,
                                            chunks_processed,
                                        )

                            if pipeline.silence_streak >= WS_VAD_HANGOVER_CHUNKS:
                                final_samples = pipeline.utterance_samples.copy()
                                pipeline.clear_utterance()
                                try:
                                    final_result = _transcribe_samples(
                                        final_samples,
                                        beam_size=WS_FINAL_BEAM_SIZE,
                                        vad_filter=WS_FINAL_VAD_FILTER,
                                    )
                                    final_text = final_result.text.strip()
                                    if final_text:
                                        pipeline.last_final_text = final_text
                                        pipeline.last_final_confidence = final_result.confidence
                                        pipeline.finals_emitted += 1
                                        _inc_metric("ws_finals_emitted_total")
                                        if pipeline.utterance_started_at > 0:
                                            final_latency_ms = (time.time() - pipeline.utterance_started_at) * 1000.0
                                            pipeline.final_latency_ms.append(final_latency_ms)
                                            PROM_WS_FINAL_LATENCY_MS.observe(final_latency_ms)
                                        if pipeline.last_partial_text:
                                            divergence = _transcript_divergence_ratio(
                                                pipeline.last_partial_text,
                                                final_text,
                                            )
                                            pipeline.divergence_ratio.append(divergence)
                                            PROM_WS_PARTIAL_FINAL_DIVERGENCE.observe(divergence)
                                        await websocket.send_json(
                                            {
                                                "type": "final_transcript",
                                                "text": final_text,
                                                "confidence": final_result.confidence,
                                            }
                                        )
                                except Exception:
                                    if VOICE_TRACE:
                                        logger.exception(
                                            "voice_trace_ws_final_failed session_id=%s chunk=%s",
                                            session_id,
                                            chunks_processed,
                                        )

                        if overlap_tail is not None and denoised is not None:
                            overlap_tail = denoised[-overlap_samples:].copy() if overlap_samples > 0 else overlap_tail

                if not used_hybrid:
                    # Legacy chunk-by-chunk fallback for compatibility or decode failures.
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
                            _inc_metric("ws_partials_emitted_total")
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

                if (
                    WS_PIPELINE_MODE == "hybrid"
                    and WS_HYBRID_READY
                    and pipeline.utterance_samples is not None
                    and pipeline.utterance_samples.size > 0
                ):
                    try:
                        final_result = _transcribe_samples(
                            pipeline.utterance_samples,
                            beam_size=WS_FINAL_BEAM_SIZE,
                            vad_filter=WS_FINAL_VAD_FILTER,
                        )
                        final_text = final_result.text.strip()
                        final_confidence = final_result.confidence
                        pipeline.last_final_text = final_text
                        pipeline.last_final_confidence = final_confidence
                        pipeline.finals_emitted += 1 if final_text else 0
                        if final_text:
                            _inc_metric("ws_finals_emitted_total")
                            if pipeline.utterance_started_at > 0:
                                final_latency_ms = (time.time() - pipeline.utterance_started_at) * 1000.0
                                pipeline.final_latency_ms.append(final_latency_ms)
                                PROM_WS_FINAL_LATENCY_MS.observe(final_latency_ms)
                            if pipeline.last_partial_text:
                                divergence = _transcript_divergence_ratio(
                                    pipeline.last_partial_text,
                                    final_text,
                                )
                                pipeline.divergence_ratio.append(divergence)
                                PROM_WS_PARTIAL_FINAL_DIVERGENCE.observe(divergence)
                    except Exception:
                        if VOICE_TRACE:
                            logger.exception("voice_trace_ws_stop_final_failed session_id=%s", session_id)
                    pipeline.clear_utterance()
                elif transcript_parts:
                    final_text = " ".join(transcript_parts).strip()
                    final_confidence = last_confidence
                elif pipeline.last_final_text:
                    final_text = pipeline.last_final_text
                    final_confidence = pipeline.last_final_confidence
                elif last_partial_text:
                    final_text = last_partial_text
                    final_confidence = 1.0

                session_partial_latency = _median(pipeline.partial_latency_ms)
                session_final_latency = _median(pipeline.final_latency_ms)
                session_divergence = _median(pipeline.divergence_ratio)
                _report_tuning_window_if_needed(
                    session_id=session_id,
                    partial_latency_ms=session_partial_latency,
                    final_latency_ms=session_final_latency,
                    divergence_ratio=session_divergence,
                    decode_fallbacks=float(pipeline.decode_fallbacks),
                )

                await websocket.send_json(
                    {
                        "type": "final_transcript",
                        "text": final_text,
                        "confidence": final_confidence,
                    }
                )
                if final_text:
                    _inc_metric("ws_finals_emitted_total")
                if VOICE_TRACE:
                    logger.info(
                        "voice_trace_ws_final session_id=%s text_len=%s confidence=%.3f chunks=%s",
                        session_id,
                        len(final_text),
                        final_confidence,
                        chunks_processed,
                    )
                await websocket.send_json(
                    {
                        "type": "session_summary",
                        "chunks": chunks_processed,
                        "partialsEmitted": pipeline.partials_emitted,
                        "finalsEmitted": pipeline.finals_emitted,
                        "partialLatencyMsMedian": round(session_partial_latency, 2),
                        "finalLatencyMsMedian": round(session_final_latency, 2),
                        "partialFinalDivergenceMedian": round(session_divergence, 4),
                        "decodeFallbacks": pipeline.decode_fallbacks,
                        "pipelineMode": WS_PIPELINE_MODE,
                    }
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
