import { ApplicationStatus } from '@/app/actions/applications-actions';

export type ApplicationColumn = {
    id: string;
    title: string;
    statuses: ApplicationStatus[];
};

export const KANBAN_COLUMNS: ApplicationColumn[] = [
    {
        id: 'bookmarked',
        title: 'Bookmarked',
        statuses: ['not_applied', 'interested']
    },
    {
        id: 'applied',
        title: 'Applied',
        statuses: ['applied']
    },
    {
        id: 'interviewing',
        title: 'Interviewing',
        statuses: ['recruiter_contacted', 'interview', 'technical_round']
    },
    {
        id: 'offer',
        title: 'Offer',
        statuses: ['offer']
    },
    {
        id: 'closed',
        title: 'Closed',
        statuses: ['rejected', 'withdrawn', 'closed']
    }
];
