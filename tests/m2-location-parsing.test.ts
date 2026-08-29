/**
 * Location parsing for discovered jobs.
 *
 * Production defect, 2026-08-29: the extractor returned location "Bangalore"
 * and the parser stored it as country="Bangalore". A single token was assumed
 * to be a country. It now becomes a CITY with country null, because a country
 * is only recognised from a bounded dictionary — the parser never invents one.
 *
 * Results are shaped to the EXISTING job_locations columns
 * (city/state/country/region/remote_allowed/remote_region); no new schema.
 *
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { parseLocation, JobNormalizer } from '@/lib/jobs/job-normalizer';

const EMPTY = {
    city: null, state: null, country: null, region: null,
    remote_allowed: false, remote_region: null,
};

describe('parseLocation', () => {
    describe('bare cities become cities, not countries', () => {
        it.each(['Bangalore', 'Bengaluru', 'Mumbai', 'New York', 'London'])(
            '%s → city, country null',
            (input) => {
                expect(parseLocation(input)).toEqual({ ...EMPTY, city: input });
            }
        );

        it('regression: the exact Production value no longer becomes a country', () => {
            const parsed = parseLocation('Bangalore');
            expect(parsed?.city).toBe('Bangalore');
            expect(parsed?.country).toBeNull();
        });
    });

    describe('bare countries become countries', () => {
        it('India', () => {
            expect(parseLocation('India')).toEqual({ ...EMPTY, country: 'India' });
        });

        it('United States', () => {
            expect(parseLocation('United States')).toEqual({ ...EMPTY, country: 'United States' });
        });

        it('normalises common aliases', () => {
            expect(parseLocation('USA')?.country).toBe('United States');
            expect(parseLocation('uk')?.country).toBe('United Kingdom');
            expect(parseLocation('UAE')?.country).toBe('United Arab Emirates');
        });
    });

    describe('city + country', () => {
        it('Bangalore, India', () => {
            expect(parseLocation('Bangalore, India')).toEqual({
                ...EMPTY, city: 'Bangalore', country: 'India',
            });
        });

        it('London, UK → normalised country', () => {
            expect(parseLocation('London, UK')).toEqual({
                ...EMPTY, city: 'London', country: 'United Kingdom',
            });
        });
    });

    describe('city + state + country', () => {
        it('San Francisco, CA, USA', () => {
            expect(parseLocation('San Francisco, CA, USA')).toEqual({
                ...EMPTY, city: 'San Francisco', state: 'CA', country: 'United States',
            });
        });

        it('treats an unrecognised tail as a state, never as a country', () => {
            const parsed = parseLocation('Pune, Maharashtra');
            expect(parsed).toEqual({ ...EMPTY, city: 'Pune', state: 'Maharashtra' });
            expect(parsed?.country).toBeNull();
        });
    });

    describe('regions', () => {
        it('recognises multi-country areas as region, not country', () => {
            expect(parseLocation('EMEA')).toEqual({ ...EMPTY, region: 'EMEA' });
            expect(parseLocation('Europe')).toEqual({ ...EMPTY, region: 'Europe' });
        });
    });

    describe('worldwide means no restriction', () => {
        it.each(['Worldwide', 'worldwide', 'Anywhere', 'work from anywhere', 'Global'])(
            '%s → remote_allowed with Worldwide scope, no city or country',
            (input) => {
                expect(parseLocation(input)).toEqual({
                    ...EMPTY, remote_allowed: true, remote_region: 'Worldwide',
                });
            }
        );
    });

    describe('remote markers', () => {
        it('bare Remote sets remote_allowed with no invented geography', () => {
            expect(parseLocation('Remote')).toEqual({ ...EMPTY, remote_allowed: true });
        });

        it('preserves a country-restricted scope verbatim and does not call it worldwide', () => {
            const parsed = parseLocation('Remote — US only');
            expect(parsed?.remote_allowed).toBe(true);
            expect(parsed?.remote_region).toBe('US only');
            expect(parsed?.remote_region).not.toBe('Worldwide');
        });

        it('handles hyphen, colon and comma separators', () => {
            expect(parseLocation('Remote - India only')?.remote_region).toBe('India only');
            expect(parseLocation('Remote: EMEA')?.remote_region).toBe('EMEA');
        });

        it('resolves a remote scope that names a real place', () => {
            const parsed = parseLocation('Remote, India');
            expect(parsed?.remote_allowed).toBe(true);
            expect(parsed?.country).toBe('India');
        });

        it('Remote Worldwide is worldwide', () => {
            expect(parseLocation('Remote Worldwide')).toEqual({
                ...EMPTY, remote_allowed: true, remote_region: 'Worldwide',
            });
        });
    });

    describe('missing and malformed input creates no row', () => {
        it.each([undefined, null, '', '   ', ',', ',,,', 42, {}, [], true])(
            '%p → null',
            (input) => {
                expect(parseLocation(input as unknown)).toBeNull();
            }
        );
    });
});

describe('JobNormalizer integration', () => {
    const base = {
        title: 'Senior Salesforce Developer',
        company: 'Omnidian',
        description: 'Salesforce Field Service work.',
        url: 'https://jobs.lever.co/omnidian/fd0cb842-611a-4539-9f6d-d6702584a4d4',
        contentHash: 'hash-1',
        rawPayload: {},
    };

    it('reproduces the Production job with the corrected location', () => {
        const r = JobNormalizer.normalize({ ...base, workMode: 'remote', location: 'Bangalore' } as any);
        expect(r?.work_mode).toBe('remote');
        expect(r?.location?.city).toBe('Bangalore');
        expect(r?.location?.country).toBeNull();
    });

    it('keeps a remote scope on the job row and the location row consistent', () => {
        const r = JobNormalizer.normalize({
            ...base, workMode: 'remote', remoteScope: 'US only', location: 'Remote — US only',
        } as any);
        expect(r?.remote_scope).toBe('US only');
        expect(r?.location?.remote_allowed).toBe(true);
        expect(r?.location?.remote_region).toBe('US only');
    });

    it('creates no location when the posting states none', () => {
        expect(JobNormalizer.normalize({ ...base, workMode: 'remote' } as any)?.location).toBeNull();
    });

    it('leaves every other normalised field unchanged', () => {
        const r = JobNormalizer.normalize({ ...base, workMode: 'hybrid', location: 'London, UK' } as any);
        expect(r?.title).toBe('Senior Salesforce Developer');
        expect(r?.company_name).toBe('Omnidian');
        expect(r?.status).toBe('discovered');
        expect(r?.employment_type).toBe('unknown');
        expect(r?.work_mode).toBe('hybrid');
        expect(r?.remote_scope).toBeNull();
    });
});
