import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type LicenseTier = 'free' | 'pro' | 'enterprise';

interface LicenseStatus {
  tier: LicenseTier;
  valid: boolean;
  isLoading: boolean;
}

export function useLicenseTier(): LicenseStatus & { refresh: () => void } {
  const [status, setStatus] = useState<LicenseStatus>({ tier: 'free', valid: false, isLoading: true });

  const check = useCallback(() => {
    setStatus(s => ({ ...s, isLoading: true }));
    invoke<{ tier: LicenseTier; valid: boolean }>('check_license')
      .then(result => setStatus({ ...result, isLoading: false }))
      .catch(() => setStatus({ tier: 'free', valid: false, isLoading: false }));
  }, []);

  useEffect(() => {
    let mounted = true;
    setStatus(s => ({ ...s, isLoading: true }));
    invoke<{ tier: LicenseTier; valid: boolean }>('check_license')
      .then(result => { if (mounted) setStatus({ ...result, isLoading: false }); })
      .catch(() => { if (mounted) setStatus({ tier: 'free', valid: false, isLoading: false }); });
    return () => { mounted = false; };
  }, []);

  return { ...status, refresh: check };
}
