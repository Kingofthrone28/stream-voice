/**
 * Browser Support Detection Utilities
 * Provides information about speech recognition capabilities across different browsers
 */


export interface BrowserSupportInfo {
  hasNativeSpeechRecognition: boolean;
  hasMediaRecorder: boolean;
  canUseServerRecognition: boolean;
  browserName: string;
  recommendedMode: 'native' | 'server';
  supportMessage: string;
}

/**
 * Detect browser capabilities for speech recognition
 */
export function detectBrowserSupport(): BrowserSupportInfo {
  const userAgent = navigator.userAgent.toLowerCase();
  
  // Detect browser
  let browserName = 'Unknown';
  if (userAgent.includes('chrome') && !userAgent.includes('edg')) {
    browserName = 'Chrome';
  } else if (userAgent.includes('firefox')) {
    browserName = 'Firefox';
  } else if (userAgent.includes('safari') && !userAgent.includes('chrome')) {
    browserName = 'Safari';
  } else if (userAgent.includes('edg')) {
    browserName = 'Edge';
  } else if (userAgent.includes('opera') || userAgent.includes('opr')) {
    browserName = 'Opera';
  }

  // Check native speech recognition support
  const hasNativeSpeechRecognition = !!(
    window.SpeechRecognition || window.webkitSpeechRecognition
  );

  // Check MediaRecorder support
  const hasMediaRecorder = !!(
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    'MediaRecorder' in window
  );

  // Server recognition requires secure context (or localhost) for mic capture.
  const canUseServerRecognition = (location.protocol === 'https:' ||
                                  location.hostname === 'localhost' ||
                                  location.hostname === '127.0.0.1') &&
                                  hasMediaRecorder;

  // Determine recommended mode
  let recommendedMode: 'native' | 'server' = 'server';
  let supportMessage = '';

  if (hasNativeSpeechRecognition) {
    recommendedMode = 'native';
    supportMessage = `${browserName} has excellent native speech recognition support.`;
  } else if (canUseServerRecognition) {
    recommendedMode = 'server';
    supportMessage = `${browserName} will use server-side speech recognition for best results.`;
  } else {
    supportMessage = `${browserName} has limited speech recognition support. Please use HTTPS or a supported browser.`;
  }

  return {
    hasNativeSpeechRecognition,
    hasMediaRecorder,
    canUseServerRecognition,
    browserName,
    recommendedMode,
    supportMessage
  };
}

/**
 * Get user-friendly browser compatibility message
 */
export function getBrowserCompatibilityMessage(): string {
  const support = detectBrowserSupport();
  
  const messages = {
    Chrome: 'Chrome supports native Web Speech, with server transcription as fallback.',
    Firefox: 'Firefox uses server-side speech recognition for voice commands.',
    Safari: 'Safari uses server-side speech recognition when microphone permissions are granted.',
    Edge: 'Edge uses server-side speech recognition or native support when available.',
    Opera: 'Opera uses server-side speech recognition for compatibility.',
    Unknown: 'Your browser will automatically select native or server speech recognition.'
  };

  return messages[support.browserName as keyof typeof messages] || messages.Unknown;
}

/**
 * Check if current environment supports speech recognition
 */
export function canUseSpeechRecognition(): boolean {
  const support = detectBrowserSupport();
  return support.hasNativeSpeechRecognition || 
         support.canUseServerRecognition;
}
