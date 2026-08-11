'use client'

import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Search } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)

    const router = useRouter()
    const supabase = createClient()

    const handleSignIn = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)

        // Simulate login for this prototype (since real users don't exist yet we will let them sign up in place)
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        })

        if (error) {
            // Try to sign up if sign in fails (for local dev ease)
            const { error: signUpError } = await supabase.auth.signUp({
                email,
                password,
            })
            if (signUpError) {
                setError(signUpError.message)
            } else {
                setMessage('Check your email for the confirmation link.')
            }
        } else {
            router.push('/dashboard')
            router.refresh()
        }

        setLoading(false)
    }

    return (
        <div className="flex min-h-screen">
            {/* Left pane - Login Form */}
            <div className="flex w-full flex-col justify-center px-4 md:w-1/2 lg:px-12 xl:px-24">
                <div className="mx-auto w-full max-w-sm">
                    <div className="mb-8 flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
                            <Search className="h-5 w-5" />
                        </div>
                        <span className="text-xl font-bold tracking-tight">AI Job Discovery</span>
                    </div>

                    <h1 className="mb-2 text-2xl font-semibold tracking-tight text-slate-900">
                        Welcome back
                    </h1>
                    <p className="mb-8 text-sm text-slate-500">
                        Enter your credentials to access your personalized job matches.
                    </p>

                    <form onSubmit={handleSignIn} className="space-y-4">
                        <div>
                            <label className="mb-2 block text-sm font-medium text-slate-700">
                                Email
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                placeholder="you@example.com"
                            />
                        </div>
                        <div>
                            <label className="mb-2 block text-sm font-medium text-slate-700">
                                Password
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                placeholder="••••••••"
                            />
                        </div>

                        {error && <p className="text-sm text-red-600">{error}</p>}
                        {message && <p className="text-sm text-green-600">{message}</p>}

                        <button
                            type="submit"
                            disabled={loading}
                            className="mt-6 flex w-full justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
                        >
                            {loading ? 'Signing in...' : 'Sign In / Register'}
                        </button>
                    </form>
                </div>
            </div>

            {/* Right pane - Aesthetic Background */}
            <div className="hidden w-1/2 bg-slate-900 md:block lg:w-1/2 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-900 via-slate-900 to-indigo-900 opacity-90" />
                <div className="absolute inset-0 bg-[url('https://transparenttextures.com/patterns/cubes.png')] opacity-10" />
                <div className="absolute inset-0 flex items-center justify-center p-12">
                    <div className="max-w-md text-center text-white">
                        <h2 className="mb-6 text-3xl font-bold tracking-tight">
                            Discover your next career move with AI
                        </h2>
                        <p className="text-lg text-slate-300">
                            Our advanced matching algorithm analyzes your profile to deliver the most relevant job opportunities, saving you hours of search time.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
