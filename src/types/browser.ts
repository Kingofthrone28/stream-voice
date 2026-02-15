export interface BrowserSupportInfo {
  hasNativeSpeechRecognition: boolean;
  hasMediaRecorder: boolean;
  canUseServerRecognition: boolean;
  browserName: string;
  recommendedMode: 'native' | 'server';
  supportMessage: string;
}
