import { createClient } from '@/utils/supabase/server'
import { Briefcase } from 'lucide-react'
import { ApplicationKanban, ApplicationKanbanData } from '@/components/applications/application-kanban'

export default async function ApplicationsPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return null;
    }

    const { data: applicationsData } = await supabase
        .from('applications')
        .select(`
            id,
            status,
            applied_at,
            updated_at,
            follow_up_date,
            recruiter_name,
            job_id,
            jobs (
                id,
                title,
                company_name,
                location,
                work_mode,
                employment_type
            )
        `)
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })

    const applications = (applicationsData || []) as unknown as ApplicationKanbanData[];

    return (
        <div className="flex h-full flex-col">
            <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900">Application Pipeline</h2>
                    <p className="text-slate-500 mt-1">Track and manage your job applications across various stages.</p>
                </div>
            </div>

            {applications.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600 mb-4">
                        <Briefcase className="h-6 w-6" />
                    </div>
                    <h3 className="text-lg font-medium text-slate-900 mb-1">No applications yet</h3>
                    <p className="text-slate-500 max-w-sm mx-auto">
                        You haven&apos;t tracked any applications through the platform yet. When you apply, they will appear here.
                    </p>
                </div>
            ) : (
                <ApplicationKanban initialApplications={applications} />
            )}
        </div>
    )
}
