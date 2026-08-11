import { createClient } from '@/utils/supabase/server'
import { PreferencesForm } from '@/components/preferences/preferences-form'
import { redirect } from 'next/navigation'

export default async function PreferencesPage() {
    const supabase = await createClient()
    const { data: authData } = await supabase.auth.getUser()

    if (!authData.user) {
        redirect('/login')
    }

    const { data: prefData } = await supabase
        .from('candidate_preferences')
        .select('*')
        .eq('user_id', authData.user.id)
        .single()

    return (
        <div className="space-y-6 max-w-4xl mx-auto pb-12">
            <div>
                <h2 className="text-3xl font-bold tracking-tight text-slate-900">Job Preferences</h2>
                <p className="text-slate-500 mt-1">Fine-tune the AI matching algorithm settings to get highly relevant recommendations.</p>
            </div>

            <div className="mt-8">
                <PreferencesForm initialData={prefData} />
            </div>
        </div>
    )
}
