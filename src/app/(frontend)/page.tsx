import { redirect } from 'next/navigation'

// The only public page is the admin. The root URL sends visitors there.
export default function Home() {
  redirect('/admin')
}
