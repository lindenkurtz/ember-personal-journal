import { supabase } from './supabase'
import { todayKey, weekStartKey } from './date'

export interface BudgetChange {
  from: string // Mon week-start key (YYYY-MM-DD)
  budget: number
}

export interface PushSettings {
  id: number
  enabled: boolean
  morning_time: string // 'HH:MM' in `timezone`
  evening_time: string // 'HH:MM' in `timezone`
  timezone: string     // IANA, e.g. 'America/Denver'
  rest_days_per_week: number // 0–7, current gym streak budget
  rest_budget_history: BudgetChange[] // sorted ascending by `from`; each entry locks in the budget effective from that week
  deep_work_rest_budget: number // 0–7, current deep work streak budget
  deep_work_rest_budget_history: BudgetChange[]
  latitude: number | null
  longitude: number | null
  location_name: string | null
}

const COLUMNS = 'id, enabled, morning_time, evening_time, timezone, rest_days_per_week, rest_budget_history, deep_work_rest_budget, deep_work_rest_budget_history, latitude, longitude, location_name'

const DEFAULTS: PushSettings = {
  id: 1,
  enabled: true,
  morning_time: '08:00',
  evening_time: '21:30',
  timezone: 'America/Denver',
  rest_days_per_week: 3,
  rest_budget_history: [],
  deep_work_rest_budget: 2,
  deep_work_rest_budget_history: [],
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
  if (!data) return DEFAULTS
  const row = data as PushSettings
  return {
    ...row,
    rest_budget_history: row.rest_budget_history ?? [],
    deep_work_rest_budget: row.deep_work_rest_budget ?? DEFAULTS.deep_work_rest_budget,
    deep_work_rest_budget_history: row.deep_work_rest_budget_history ?? []
  }
}

export async function updateSettings(patch: Partial<PushSettings>): Promise<PushSettings> {
  const { data, error } = await supabase
    .from('push_settings')
    .upsert({ id: 1, ...patch }, { onConflict: 'id' })
    .select(COLUMNS)
    .single()
  if (error) throw error
  const row = data as PushSettings
  return {
    ...row,
    rest_budget_history: row.rest_budget_history ?? [],
    deep_work_rest_budget: row.deep_work_rest_budget ?? DEFAULTS.deep_work_rest_budget,
    deep_work_rest_budget_history: row.deep_work_rest_budget_history ?? []
  }
}

/**
 * Sets the rest-day budget while preserving past weeks' streak status. Each
 * call records the new budget against the current week so the streak resolver
 * can replay the correct budget for every historical week.
 */
export async function setRestBudget(
  current: PushSettings,
  newBudget: number
): Promise<PushSettings> {
  const oldBudget = current.rest_days_per_week
  const history = [...(current.rest_budget_history ?? [])]
  const currentWeek = weekStartKey(todayKey())

  if (history.length === 0) {
    if (newBudget === oldBudget) {
      return current
    }
    history.push({ from: '2000-01-01', budget: oldBudget })
    history.push({ from: currentWeek, budget: newBudget })
  } else {
    const last = history[history.length - 1]
    if (last.from === currentWeek) {
      last.budget = newBudget
    } else {
      history.push({ from: currentWeek, budget: newBudget })
    }
  }

  return updateSettings({ rest_days_per_week: newBudget, rest_budget_history: history })
}

export async function setDeepWorkRestBudget(
  current: PushSettings,
  newBudget: number
): Promise<PushSettings> {
  const oldBudget = current.deep_work_rest_budget
  const history = [...(current.deep_work_rest_budget_history ?? [])]
  const currentWeek = weekStartKey(todayKey())

  if (history.length === 0) {
    if (newBudget === oldBudget) {
      return current
    }
    history.push({ from: '2000-01-01', budget: oldBudget })
    history.push({ from: currentWeek, budget: newBudget })
  } else {
    const last = history[history.length - 1]
    if (last.from === currentWeek) {
      last.budget = newBudget
    } else {
      history.push({ from: currentWeek, budget: newBudget })
    }
  }

  return updateSettings({ deep_work_rest_budget: newBudget, deep_work_rest_budget_history: history })
}
