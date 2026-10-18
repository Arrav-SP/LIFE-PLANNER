import { useSearchParams } from 'react-router-dom'
import { Segmented } from './misc'

/** Pages that share one menu item, switched with ?tab= (the first tab is the default, without the param). */
export const HUBS = {
  goals: [
    { value: 'goals', label: 'Goals' },
    { value: 'projects', label: 'Projects' },
  ],
  review: [
    { value: 'week', label: 'This week' },
    { value: 'trends', label: 'Trends' },
  ],
} as const

export type Hub = keyof typeof HUBS

export function useHubTab(hub: Hub): string {
  const [params] = useSearchParams()
  const tab = params.get('tab')
  return HUBS[hub].some((o) => o.value === tab) ? tab! : HUBS[hub][0].value
}

export function HubTabs({ hub }: { hub: Hub }) {
  const [, setParams] = useSearchParams()
  const tab = useHubTab(hub)
  // Switching tab drops the other page's params (e.g. an open project).
  return <Segmented label="Section" className="mb-4" value={tab} onChange={(v) => setParams(v === HUBS[hub][0].value ? {} : { tab: v })} options={[...HUBS[hub]]} />
}
