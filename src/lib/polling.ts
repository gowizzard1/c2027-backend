/** Official ward boundary used for Turbo Constituency polling-agent operations. */
export const TURBO_COUNTY = 'Uasin Gishu';
export const TURBO_CONSTITUENCY = 'Turbo';

export const TURBO_WARDS = [
  'Kamagut',
  'Kapsaos',
  'Kiplombe',
  'Huruma',
  'Ngenyilel',
  'Tapsagoi',
] as const;

export function isTurboWard(ward: string): boolean {
  return TURBO_WARDS.some(allowed => allowed.toLowerCase() === ward.trim().toLowerCase());
}
