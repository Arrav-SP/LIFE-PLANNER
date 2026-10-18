import { Navigate, useLocation } from 'react-router-dom'
import { redirectTarget } from '@/lib/redirects'

/** An old page address: send it to where that page lives now. */
export function LegacyRedirect() {
  const { pathname, search } = useLocation()
  return <Navigate replace to={redirectTarget(pathname, search)} />
}
