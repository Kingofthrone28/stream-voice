/**
 * Voice Control Information Component
 * Displays browser compatibility and current speech recognition status
 */

'use client';

import { useEffect, useState } from 'react';
import { detectBrowserSupport, getBrowserCompatibilityMessage } from '@/utils/browserSupport';

interface VoiceControlInfoProps {
  currentMode?: string;
  isVisible?: boolean;
}

export const VoiceControlInfo = ({ 
  currentMode = 'detecting...', 
  isVisible = true 
}: VoiceControlInfoProps) => {
  const [supportInfo, setSupportInfo] = useState<string>('');
  const [browserName, setBrowserName] = useState<string>('');

  useEffect(() => {
    const support = detectBrowserSupport();
    setSupportInfo(support.supportMessage);
    setBrowserName(support.browserName);
  }, []);

  if (!isVisible) return null;

  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 bg-blue-100 dark:bg-blue-800 rounded-full flex items-center justify-center">
            🎤
          </div>
        </div>
        
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-1">
            Voice Control Status
          </h3>
          
          <div className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
            <div className="flex items-center gap-2">
              <span className="font-medium">Browser:</span>
              <span>{browserName}</span>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="font-medium">Recognition Mode:</span>
              <span className="capitalize">{currentMode}</span>
              {currentMode === 'native' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100">
                  Best Performance
                </span>
              )}
            </div>
            
            <p className="text-xs leading-relaxed">
              {supportInfo}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}; 