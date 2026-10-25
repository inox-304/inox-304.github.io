export const CRM_ORIGIN = 'https://inox304-panel.onrender.com';
export const SOURCES = ['website', 'google', 'facebook', 'instagram', 'tiktok', 'whatsapp', 'store', 'referral', 'other', 'unknown'] as const;
export type CrmSource = typeof SOURCES[number];
export interface Attribution { source: CrmSource; campaign: string; medium: string }
const STORAGE_KEY = 'inox:campaign:v1';

function label(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  // Campaign labels only: discard URLs, email addresses, control characters and markup.
  if (/[\x00-\x1f<>@?=]/.test(value) || /:\/\//.test(value)) return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, maximum);
}

export function normalizeSource(value: unknown): CrmSource {
  const aliases: Record<string, CrmSource> = { fb: 'facebook', meta: 'facebook', ig: 'instagram', wa: 'whatsapp', googleads: 'google' };
  const source = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!source) return 'website';
  return aliases[source] || (SOURCES.includes(source as CrmSource) ? source as CrmSource : 'other');
}

export function readAttribution(search: string, referrer = '', previous?: unknown): Attribution {
  const params = new URLSearchParams(search);
  if (params.has('utm_source') || params.has('utm_campaign') || params.has('utm_medium')) {
    return { source: normalizeSource(params.get('utm_source')), campaign: label(params.get('utm_campaign'), 120), medium: label(params.get('utm_medium'), 80) };
  }
  if (previous && typeof previous === 'object' && 'source' in previous && 'campaign' in previous && 'medium' in previous) {
    return { source: normalizeSource(previous.source), campaign: label(previous.campaign, 120), medium: label(previous.medium, 80) };
  }
  let host = '';
  try { host = new URL(referrer).hostname.toLowerCase(); } catch { /* Direct visit. */ }
  const domain = (name: string) => host === name || host.endsWith(`.${name}`);
  const source: CrmSource = domain('google.com') || domain('google.com.pe') ? 'google' : domain('facebook.com') ? 'facebook' : domain('instagram.com') ? 'instagram' : domain('tiktok.com') ? 'tiktok' : domain('whatsapp.com') || domain('wa.me') ? 'whatsapp' : 'website';
  return { source, campaign: '', medium: '' };
}

export function metricsAllowed(navigatorValue: { doNotTrack?: string | null; globalPrivacyControl?: boolean }): boolean {
  return navigatorValue.doNotTrack !== '1' && navigatorValue.doNotTrack !== 'yes' && navigatorValue.globalPrivacyControl !== true;
}

export function currentAttribution(): Attribution {
  let previous: unknown;
  const allowed = metricsAllowed(navigator);
  if (allowed) {
    try { previous = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null'); } catch { /* Storage is optional. */ }
  }
  const attribution = readAttribution(location.search, document.referrer, previous);
  if (allowed) {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attribution)); } catch { /* Private browsing still works. */ }
  }
  return attribution;
}

export function crmEndpoint(path: 'inquiries' | 'events', serverMode = false): string {
  return `${serverMode ? '' : CRM_ORIGIN}/api/crm/${path}/`;
}
