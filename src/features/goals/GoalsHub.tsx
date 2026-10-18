import { useHubTab } from '@/components/ui/HubTabs'
import { GoalsPage } from './GoalsPage'
import { ProjectsPage } from './ProjectsPage'

export function GoalsHub() {
  return useHubTab('goals') === 'projects' ? <ProjectsPage /> : <GoalsPage />
}
