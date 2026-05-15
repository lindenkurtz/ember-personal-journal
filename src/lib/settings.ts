import { supabase } from './supabase'

export interface PushSettings {
  id: number
  enabled: boolean
  morning_time: string // 'HH:MM' in `timezone`
  evening_time: string // 'HH:MM' in `timezone`
  timezone: string     // IANA, e.g. 'America/Denver'
  rest_days_per_week: number // 0–7, gym streak budget
  latitude: number | null
  longitude: number | null
  location_name: string | null
}

const COLUMNS = 'id, enabled, morning_time, evening_time, timezone, rest_days_per_week, latitude, longitude, location_name'

const DEFAULTS: PushSettings = {
  id: 1,
  enabled: true,
  morning_time: '08:00',
  evening_time: '21:30',
  timezone: 'America/Denver',
  rest_days_per_week: 3,
  latitude: null,
  longitude: null,
  location_name: null
}

export async function getSettings(): Promise<PushSettings> {
  const { data, error } = await supabase
    .from('push_settings')
    .select(COLUMNS)
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  return (data as PushSettings | null) ?? DEFAULTS
}

export async function updateSettings(patch: Partial<PushSettings>): Promise<PushSettings> {
  const { data, error } = await supabase
    .from('push_settings')
    .upsert({ id: 1, ...patch }, { onConflict: 'id' })
    .select(COLUMNS)
    .single()
  if (error) throw error
  return data as PushSettings
}
