import { redirect } from 'next/navigation'

// The feedback overview moved into the admin area
export default function FeedbackPage() {
  redirect('/admin')
}
