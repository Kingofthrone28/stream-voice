export interface BrowserSupportInfo {
  hasNativeSpeechRecognition: boolean;
  hasMediaRecorder: boolean;
  canUsePolyfill: boolean;
  browserName: string;
  recommendedMode: 'native' | 'server' | 'polyfill';
  supportMessage: string;
}