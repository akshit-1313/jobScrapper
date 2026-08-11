import { redirect } from 'next/navigation'

export default function Page() {
  // Middleware handles actual route protection, 
  // but if users hit the root we redirect appropriately.
  redirect('/dashboard')
}
