import { useHubTab } from '@/components/ui/HubTabs'
import { AnalyticsPage } from './AnalyticsPage'
import { WeeklyReviewPage } from './WeeklyReviewPage'

export function ReviewHub() {
  return useHubTab('review') === 'trends' ? <AnalyticsPage /> : <WeeklyReviewPage />
}
