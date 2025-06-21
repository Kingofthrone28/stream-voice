/**
 * Browser Support Detection Utilities
 * Provides information about speech recognition capabilities across different browsers
 */


export interface BrowserSupportInfo {
  hasNativeSpeechRecognition: boolean;
  hasMediaRecorder: boolean;
  canUsePolyfill: boolean;
  browserName: string;
  recommendedMode: 'native' | 'server' | 'polyfill';
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
    navigator.mediaDevices.getUserMedia &&
    'MediaRecorder' in window
  );

  // Check if polyfill can be used (requires HTTPS or localhost)
  const canUsePolyfill = location.protocol === 'https:' || 
                        location.hostname === 'localhost' ||
                        location.hostname === '127.0.0.1';

  // Determine recommended mode
  let recommendedMode: 'native' | 'server' | 'polyfill' = 'polyfill';
  let supportMessage = '';

  if (hasNativeSpeechRecognition) {
    recommendedMode = 'native';
    supportMessage = `${browserName} has excellent native speech recognition support.`;
  } else if (hasMediaRecorder && canUsePolyfill) {
    recommendedMode = 'server';
    supportMessage = `${browserName} will use server-side speech recognition for best results.`;
  } else if (canUsePolyfill) {
    recommendedMode = 'polyfill';
    supportMessage = `${browserName} will use a JavaScript polyfill for speech recognition.`;
  } else {
    supportMessage = `${browserName} has limited speech recognition support. Please use HTTPS or a supported browser.`;
  }

  return {
    hasNativeSpeechRecognition,
    hasMediaRecorder,
    canUsePolyfill,
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
    Chrome: 'Chrome provides the best speech recognition experience with native Web Speech API support.',
    Firefox: 'Firefox will use our server-side speech recognition or JavaScript polyfill for voice commands.',
    Safari: 'Safari has limited speech recognition support. Server-side processing will be used when possible.',
    Edge: 'Edge supports speech recognition through our compatibility layer.',
    Opera: 'Opera will use our fallback speech recognition methods.',
    Unknown: 'Your browser will automatically select the best available speech recognition method.'
  };

  return messages[support.browserName as keyof typeof messages] || messages.Unknown;
}

/**
 * Check if current environment supports speech recognition
 */
export function canUseSpeechRecognition(): boolean {
  const support = detectBrowserSupport();
  return support.hasNativeSpeechRecognition || 
         support.hasMediaRecorder || 
         support.canUsePolyfill;
} 