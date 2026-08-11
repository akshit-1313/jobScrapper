-- 008: Seed shared system data (job_sources, jobs, job_source_mappings, job_locations, job_skills)
-- No user-specific data seeded. Users create accounts and profiles through the app.

-------------------------------------------------------
-- JOB SOURCES
-------------------------------------------------------

INSERT INTO public.job_sources (id, name, domain, source_type, base_url, active, priority, crawl_frequency, restriction_notes) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'LinkedIn Jobs', 'linkedin.com', 'job_board', 'https://www.linkedin.com/jobs', true, 8, 'daily', 'Requires login for full details; rate-limited'),
  ('a0000000-0000-0000-0000-000000000002', 'Indeed', 'indeed.com', 'job_board', 'https://www.indeed.com', true, 7, 'daily', NULL),
  ('a0000000-0000-0000-0000-000000000003', 'Naukri', 'naukri.com', 'job_board', 'https://www.naukri.com', true, 8, 'daily', 'Primary India job board'),
  ('a0000000-0000-0000-0000-000000000004', 'Greenhouse', 'greenhouse.io', 'ats', 'https://boards.greenhouse.io', true, 6, 'weekly', NULL),
  ('a0000000-0000-0000-0000-000000000005', 'Lever', 'lever.co', 'ats', 'https://jobs.lever.co', true, 6, 'weekly', NULL),
  ('a0000000-0000-0000-0000-000000000006', 'Workday', 'myworkdayjobs.com', 'ats', 'https://www.myworkdayjobs.com', true, 5, 'weekly', 'Heavy JS rendering'),
  ('a0000000-0000-0000-0000-000000000007', 'Google Careers', 'google.com', 'company_careers', 'https://careers.google.com', true, 9, 'weekly', NULL),
  ('a0000000-0000-0000-0000-000000000008', 'Microsoft Careers', 'microsoft.com', 'company_careers', 'https://careers.microsoft.com', true, 9, 'weekly', NULL),
  ('a0000000-0000-0000-0000-000000000009', 'Salesforce Careers', 'salesforce.com', 'company_careers', 'https://careers.salesforce.com', true, 9, 'weekly', NULL),
  ('a0000000-0000-0000-0000-000000000010', 'RemoteOK', 'remoteok.com', 'job_board', 'https://remoteok.com', true, 7, 'daily', 'Remote-focused job board');

-------------------------------------------------------
-- JOBS (25 realistic jobs)
-------------------------------------------------------

INSERT INTO public.jobs (id, canonical_id, title, normalized_title, company_name, company_domain, description, employment_type, experience_min, experience_max, salary_min, salary_max, salary_currency, salary_period, work_mode, remote_scope, visa_sponsorship, relocation_support, job_url, canonical_url, external_job_id, posted_at, status) VALUES

-- 1. Salesforce Developer - Remote India
('b0000000-0000-0000-0000-000000000001', 'sf-dev-infosys-001', 'Senior Salesforce Developer', 'senior salesforce developer', 'Infosys', 'infosys.com',
 'We are looking for a Senior Salesforce Developer to join our digital transformation team. You will design and develop custom Salesforce solutions using Apex, Lightning Web Components, and Salesforce APIs. The role involves working with cross-functional teams to deliver enterprise CRM solutions.

Requirements:
- 5+ years Salesforce development experience
- Strong Apex and LWC skills
- Experience with Salesforce integrations (REST/SOAP APIs)
- Salesforce Platform Developer I/II certification preferred
- Experience with CI/CD for Salesforce (SFDX, Git)
- Good understanding of Salesforce security model',
 'full_time', 5, 8, 1500000, 2500000, 'INR', 'yearly', 'remote', 'India', 'unknown', 'no',
 'https://careers.infosys.com/jobs/sf-dev-001', 'https://careers.infosys.com/jobs/sf-dev-001', 'INF-SF-001',
 '2026-08-01T00:00:00Z', 'active'),

-- 2. Salesforce Architect - Hybrid Bangalore
('b0000000-0000-0000-0000-000000000002', 'sf-arch-deloitte-001', 'Salesforce Technical Architect', 'salesforce technical architect', 'Deloitte', 'deloitte.com',
 'Seeking a Salesforce Technical Architect to lead solution design for enterprise clients. You will be responsible for architectural decisions, technical governance, and mentoring developers.

Requirements:
- 8+ years Salesforce experience with 3+ years in architecture
- Deep knowledge of Salesforce platform limits and governor limits
- Experience with multi-org strategies and large data volumes
- Salesforce Application Architect or System Architect certification
- Experience with integration patterns (MuleSoft, Dell Boomi)
- Strong communication and stakeholder management',
 'full_time', 8, 15, 3000000, 5000000, 'INR', 'yearly', 'hybrid', NULL, 'unknown', 'no',
 'https://apply.deloitte.com/sf-arch-001', 'https://apply.deloitte.com/sf-arch-001', 'DEL-SF-ARCH-001',
 '2026-07-28T00:00:00Z', 'active'),

-- 3. Full Stack Developer - Remote Worldwide
('b0000000-0000-0000-0000-000000000003', 'fs-dev-gitlab-001', 'Senior Full Stack Engineer', 'senior full stack engineer', 'GitLab', 'gitlab.com',
 'GitLab is hiring a Senior Full Stack Engineer to work on our core platform. You will build features that serve millions of developers worldwide. We are a fully remote company with team members in 65+ countries.

Requirements:
- 5+ years in full-stack web development
- Strong Ruby on Rails and Vue.js experience
- PostgreSQL expertise
- Experience with CI/CD pipelines
- Comfortable with async communication and remote work
- Experience contributing to open-source projects preferred',
 'full_time', 5, 10, 120000, 180000, 'USD', 'yearly', 'remote', 'Worldwide', 'unknown', 'no',
 'https://about.gitlab.com/jobs/senior-fullstack-engineer', 'https://about.gitlab.com/jobs/senior-fullstack-engineer', 'GL-FS-001',
 '2026-08-03T00:00:00Z', 'active'),

-- 4. React Developer - Office Pune
('b0000000-0000-0000-0000-000000000004', 'react-dev-tcs-001', 'React.js Developer', 'react developer', 'Tata Consultancy Services', 'tcs.com',
 'TCS is looking for a React.js Developer for our Pune delivery center. You will work on client-facing web applications for banking and financial services clients.

Requirements:
- 3+ years React.js experience
- TypeScript proficiency
- State management (Redux, Zustand)
- RESTful API integration
- Unit testing (Jest, React Testing Library)
- Agile/Scrum experience',
 'full_time', 3, 6, 800000, 1400000, 'INR', 'yearly', 'office', NULL, 'unknown', 'no',
 'https://ibegin.tcs.com/iBegin/jobs/react-dev-001', 'https://ibegin.tcs.com/iBegin/jobs/react-dev-001', 'TCS-REACT-001',
 '2026-08-05T00:00:00Z', 'active'),

-- 5. Cloud Engineer - Remote India
('b0000000-0000-0000-0000-000000000005', 'cloud-eng-wipro-001', 'Senior Cloud Engineer (AWS)', 'senior cloud engineer', 'Wipro', 'wipro.com',
 'Join Wipro''s cloud practice as a Senior Cloud Engineer. Design and implement cloud infrastructure for enterprise clients using AWS services.

Requirements:
- 5+ years cloud engineering experience
- AWS Solutions Architect certification
- Terraform/CloudFormation expertise
- Kubernetes and Docker experience
- CI/CD pipeline design
- Security best practices (IAM, VPC, encryption)',
 'full_time', 5, 10, 1800000, 3000000, 'INR', 'yearly', 'remote', 'India', 'unknown', 'no',
 'https://careers.wipro.com/cloud-eng-001', 'https://careers.wipro.com/cloud-eng-001', 'WIP-CLOUD-001',
 '2026-08-02T00:00:00Z', 'active'),

-- 6. Backend Engineer - Remote US Only
('b0000000-0000-0000-0000-000000000006', 'be-eng-stripe-001', 'Backend Engineer - Payments', 'backend engineer', 'Stripe', 'stripe.com',
 'Stripe is looking for a Backend Engineer to work on our core payments infrastructure. Build reliable, scalable systems that process billions of dollars.

Requirements:
- 4+ years backend development
- Java, Go, or Ruby experience
- Distributed systems knowledge
- Database design and optimization
- High-throughput system design
- Payment industry experience preferred',
 'full_time', 4, 8, 150000, 220000, 'USD', 'yearly', 'remote', 'US only', 'yes', 'no',
 'https://stripe.com/jobs/be-eng-001', 'https://stripe.com/jobs/be-eng-001', 'STRIPE-BE-001',
 '2026-07-30T00:00:00Z', 'active'),

-- 7. DevOps Engineer - Hybrid Bangalore
('b0000000-0000-0000-0000-000000000007', 'devops-flipkart-001', 'DevOps Engineer', 'devops engineer', 'Flipkart', 'flipkart.com',
 'Flipkart is hiring a DevOps Engineer for our platform engineering team in Bangalore. Automate infrastructure, manage CI/CD pipelines, and ensure platform reliability.

Requirements:
- 3+ years DevOps/SRE experience
- Linux administration
- Docker, Kubernetes
- Jenkins/GitLab CI
- Monitoring (Prometheus, Grafana, ELK)
- Scripting (Python, Bash)',
 'full_time', 3, 7, 1200000, 2200000, 'INR', 'yearly', 'hybrid', NULL, 'unknown', 'no',
 'https://www.flipkartcareers.com/devops-001', 'https://www.flipkartcareers.com/devops-001', 'FK-DEVOPS-001',
 '2026-08-04T00:00:00Z', 'active'),

-- 8. Data Engineer - Remote Worldwide
('b0000000-0000-0000-0000-000000000008', 'data-eng-spotify-001', 'Senior Data Engineer', 'senior data engineer', 'Spotify', 'spotify.com',
 'Join Spotify''s data platform team. Build data pipelines that power music recommendations for 500M+ users.

Requirements:
- 5+ years data engineering
- Apache Spark, Kafka, Airflow
- Python and SQL mastery
- Data warehouse design (BigQuery, Snowflake, or Redshift)
- Data quality frameworks
- Streaming data processing experience',
 'full_time', 5, 10, 130000, 190000, 'USD', 'yearly', 'remote', 'Worldwide', 'unknown', 'yes',
 'https://www.lifeatspotify.com/jobs/data-eng-001', 'https://www.lifeatspotify.com/jobs/data-eng-001', 'SPOT-DE-001',
 '2026-08-01T00:00:00Z', 'active'),

-- 9. Salesforce Admin - Office Hyderabad
('b0000000-0000-0000-0000-000000000009', 'sf-admin-cognizant-001', 'Salesforce Administrator', 'salesforce administrator', 'Cognizant', 'cognizant.com',
 'Cognizant is looking for a certified Salesforce Administrator for our Hyderabad office. Manage and configure Salesforce orgs for enterprise clients.

Requirements:
- 2+ years Salesforce Admin experience
- Salesforce Administrator certification required
- User management, security model, data management
- Reports and dashboards
- Process Builder, Flow Builder
- Knowledge of Apex basics preferred',
 'full_time', 2, 5, 600000, 1000000, 'INR', 'yearly', 'office', NULL, 'unknown', 'no',
 'https://careers.cognizant.com/sf-admin-001', 'https://careers.cognizant.com/sf-admin-001', 'COG-SF-ADM-001',
 '2026-08-06T00:00:00Z', 'active'),

-- 10. Product Manager - Hybrid Mumbai
('b0000000-0000-0000-0000-000000000010', 'pm-razorpay-001', 'Senior Product Manager - Payments', 'senior product manager', 'Razorpay', 'razorpay.com',
 'Razorpay is hiring a Senior Product Manager to lead our payment gateway product. Define product roadmap and drive execution.

Requirements:
- 5+ years product management
- Fintech/payments experience preferred
- Data-driven decision making
- Strong stakeholder management
- Understanding of payment regulations (RBI, PCI-DSS)
- Technical background preferred',
 'full_time', 5, 10, 2500000, 4000000, 'INR', 'yearly', 'hybrid', NULL, 'unknown', 'no',
 'https://razorpay.com/jobs/pm-001', 'https://razorpay.com/jobs/pm-001', 'RP-PM-001',
 '2026-08-03T00:00:00Z', 'active'),

-- 11. SRE - Remote EMEA
('b0000000-0000-0000-0000-000000000011', 'sre-datadog-001', 'Site Reliability Engineer', 'site reliability engineer', 'Datadog', 'datadog.com',
 'Datadog is seeking an SRE to ensure the reliability and performance of our monitoring platform. Remote position within EMEA time zones.

Requirements:
- 4+ years SRE/DevOps experience
- Go, Python, or Ruby
- Kubernetes at scale
- Observability and monitoring expertise
- Incident management experience
- On-call rotation participation',
 'full_time', 4, 8, 80000, 120000, 'EUR', 'yearly', 'remote', 'EMEA', 'yes', 'no',
 'https://careers.datadoghq.com/sre-001', 'https://careers.datadoghq.com/sre-001', 'DD-SRE-001',
 '2026-07-29T00:00:00Z', 'active'),

-- 12. Node.js Developer - Remote India
('b0000000-0000-0000-0000-000000000012', 'node-dev-freshworks-001', 'Node.js Backend Developer', 'nodejs backend developer', 'Freshworks', 'freshworks.com',
 'Freshworks is looking for a Node.js Backend Developer to work on our customer engagement platform.

Requirements:
- 3+ years Node.js/TypeScript experience
- Express.js or NestJS
- PostgreSQL or MongoDB
- Redis caching
- Microservices architecture
- REST and GraphQL APIs',
 'full_time', 3, 6, 1000000, 1800000, 'INR', 'yearly', 'remote', 'India', 'unknown', 'no',
 'https://www.freshworks.com/company/careers/node-dev-001', 'https://www.freshworks.com/company/careers/node-dev-001', 'FW-NODE-001',
 '2026-08-05T00:00:00Z', 'active'),

-- 13. ML Engineer - Office Bangalore
('b0000000-0000-0000-0000-000000000013', 'ml-eng-google-001', 'Machine Learning Engineer', 'machine learning engineer', 'Google', 'google.com',
 'Google is hiring an ML Engineer for our Bangalore office. Work on large-scale ML systems for Google Search and Ads.

Requirements:
- 4+ years ML engineering
- Python, TensorFlow or PyTorch
- Large-scale data processing
- ML model deployment and monitoring
- Strong math/statistics background
- Published research preferred',
 'full_time', 4, 10, 3000000, 6000000, 'INR', 'yearly', 'office', NULL, 'yes', 'yes',
 'https://careers.google.com/jobs/ml-eng-001', 'https://careers.google.com/jobs/ml-eng-001', 'GOOG-ML-001',
 '2026-07-25T00:00:00Z', 'active'),

-- 14. Salesforce Commerce Cloud Developer - Remote India
('b0000000-0000-0000-0000-000000000014', 'sfcc-dev-accenture-001', 'Salesforce Commerce Cloud Developer', 'salesforce commerce cloud developer', 'Accenture', 'accenture.com',
 'Accenture is seeking a Salesforce Commerce Cloud (B2C) Developer for e-commerce platform implementations.

Requirements:
- 3+ years SFCC B2C development
- SFRA, Page Designer
- JavaScript, ISML
- Commerce Cloud API and OCAPI
- Payment and shipping integrations
- B2C Commerce Developer certification preferred',
 'full_time', 3, 7, 1200000, 2000000, 'INR', 'yearly', 'remote', 'India', 'unknown', 'no',
 'https://www.accenture.com/careers/sfcc-dev-001', 'https://www.accenture.com/careers/sfcc-dev-001', 'ACC-SFCC-001',
 '2026-08-02T00:00:00Z', 'active'),

-- 15. Frontend Engineer - Remote Worldwide
('b0000000-0000-0000-0000-000000000015', 'fe-eng-vercel-001', 'Frontend Engineer', 'frontend engineer', 'Vercel', 'vercel.com',
 'Join Vercel to build the future of frontend development. Work on Next.js, Turbopack, and our deployment platform.

Requirements:
- 4+ years frontend development
- React and Next.js expertise
- TypeScript mastery
- Performance optimization
- Accessibility (WCAG) knowledge
- Open-source contribution experience',
 'full_time', 4, 8, 140000, 200000, 'USD', 'yearly', 'remote', 'Worldwide', 'unknown', 'no',
 'https://vercel.com/careers/fe-eng-001', 'https://vercel.com/careers/fe-eng-001', 'VCL-FE-001',
 '2026-08-06T00:00:00Z', 'active'),

-- 16. Salesforce Integration Developer - Hybrid Pune
('b0000000-0000-0000-0000-000000000016', 'sf-int-persistent-001', 'Salesforce Integration Developer', 'salesforce integration developer', 'Persistent Systems', 'persistent.com',
 'Persistent Systems is hiring a Salesforce Integration Developer for our Pune office. Build enterprise integrations using MuleSoft and Salesforce APIs.

Requirements:
- 4+ years Salesforce development
- MuleSoft Anypoint Platform experience
- REST/SOAP API development
- Salesforce Connect, Platform Events
- Error handling and retry patterns
- MuleSoft Developer certification preferred',
 'full_time', 4, 8, 1200000, 2200000, 'INR', 'yearly', 'hybrid', NULL, 'unknown', 'no',
 'https://careers.persistent.com/sf-int-001', 'https://careers.persistent.com/sf-int-001', 'PERS-SF-INT-001',
 '2026-08-04T00:00:00Z', 'active'),

-- 17. Python Developer - Remote India
('b0000000-0000-0000-0000-000000000017', 'python-dev-zoho-001', 'Senior Python Developer', 'senior python developer', 'Zoho', 'zoho.com',
 'Zoho is hiring a Senior Python Developer for our analytics platform team.

Requirements:
- 5+ years Python experience
- Django or FastAPI
- PostgreSQL
- Celery/async task processing
- Data processing pipelines
- API design best practices',
 'full_time', 5, 9, 1400000, 2400000, 'INR', 'yearly', 'remote', 'India', 'unknown', 'no',
 'https://www.zoho.com/careers/python-dev-001', 'https://www.zoho.com/careers/python-dev-001', 'ZOHO-PY-001',
 '2026-08-07T00:00:00Z', 'active'),

-- 18. Technical Lead - Hybrid Bangalore
('b0000000-0000-0000-0000-000000000018', 'tech-lead-microsoft-001', 'Technical Lead - Azure', 'technical lead', 'Microsoft', 'microsoft.com',
 'Microsoft India is hiring a Technical Lead for our Azure cloud team in Bangalore. Lead a team building Azure PaaS services.

Requirements:
- 8+ years software engineering
- 3+ years in a lead role
- C#, .NET, or Java
- Cloud-native architecture
- Distributed systems
- Team mentoring and code review excellence',
 'full_time', 8, 14, 3500000, 6000000, 'INR', 'yearly', 'hybrid', NULL, 'yes', 'yes',
 'https://careers.microsoft.com/tech-lead-001', 'https://careers.microsoft.com/tech-lead-001', 'MSFT-TL-001',
 '2026-07-27T00:00:00Z', 'active'),

-- 19. QA Automation Engineer - Office Chennai
('b0000000-0000-0000-0000-000000000019', 'qa-auto-hcl-001', 'QA Automation Engineer', 'qa automation engineer', 'HCLTech', 'hcltech.com',
 'HCLTech is looking for a QA Automation Engineer for our Chennai delivery center.

Requirements:
- 3+ years test automation experience
- Selenium, Cypress, or Playwright
- Java or JavaScript
- API testing (Postman, REST Assured)
- CI/CD integration
- Performance testing basics (JMeter)',
 'full_time', 3, 6, 700000, 1200000, 'INR', 'yearly', 'office', NULL, 'unknown', 'no',
 'https://www.hcltech.com/careers/qa-auto-001', 'https://www.hcltech.com/careers/qa-auto-001', 'HCL-QA-001',
 '2026-08-06T00:00:00Z', 'active'),

-- 20. Solutions Architect - Remote APAC
('b0000000-0000-0000-0000-000000000020', 'sa-aws-001', 'Solutions Architect', 'solutions architect', 'Amazon Web Services', 'aws.amazon.com',
 'AWS is hiring a Solutions Architect to work with enterprise customers in the APAC region. Help customers design cloud architectures.

Requirements:
- 7+ years in software architecture
- AWS Professional certification preferred
- Multi-cloud awareness
- Strong presentation skills
- Pre-sales / customer-facing experience
- Networking and security knowledge',
 'full_time', 7, 12, 3000000, 5500000, 'INR', 'yearly', 'remote', 'APAC', 'unknown', 'no',
 'https://www.amazon.jobs/en/jobs/sa-001', 'https://www.amazon.jobs/en/jobs/sa-001', 'AWS-SA-001',
 '2026-08-01T00:00:00Z', 'active'),

-- 21. Salesforce CPQ Specialist - Remote India
('b0000000-0000-0000-0000-000000000021', 'sf-cpq-capgemini-001', 'Salesforce CPQ Specialist', 'salesforce cpq specialist', 'Capgemini', 'capgemini.com',
 'Capgemini is seeking a Salesforce CPQ Specialist for configure-price-quote implementations.

Requirements:
- 4+ years Salesforce CPQ/Billing
- Product bundling and pricing rules
- Quote templates and document generation
- Apex triggers for CPQ customization
- Experience with Salesforce Industries (Vlocity) a plus
- CPQ Specialist certification preferred',
 'full_time', 4, 8, 1500000, 2500000, 'INR', 'yearly', 'remote', 'India', 'unknown', 'no',
 'https://www.capgemini.com/careers/sf-cpq-001', 'https://www.capgemini.com/careers/sf-cpq-001', 'CAP-SF-CPQ-001',
 '2026-08-03T00:00:00Z', 'active'),

-- 22. Mobile Developer - Remote Worldwide
('b0000000-0000-0000-0000-000000000022', 'mobile-dev-github-001', 'Senior Mobile Engineer (React Native)', 'senior mobile engineer', 'GitHub', 'github.com',
 'GitHub is hiring a Senior Mobile Engineer to work on GitHub Mobile. Build features used by developers worldwide.

Requirements:
- 5+ years mobile development
- React Native expertise
- iOS and Android platform knowledge
- TypeScript
- GraphQL
- Mobile CI/CD and testing frameworks',
 'full_time', 5, 10, 140000, 200000, 'USD', 'yearly', 'remote', 'Worldwide', 'yes', 'no',
 'https://github.com/about/careers/mobile-eng-001', 'https://github.com/about/careers/mobile-eng-001', 'GH-MOB-001',
 '2026-08-05T00:00:00Z', 'active'),

-- 23. LWC Developer - Remote India
('b0000000-0000-0000-0000-000000000023', 'lwc-dev-techm-001', 'Lightning Web Components Developer', 'lwc developer', 'Tech Mahindra', 'techmahindra.com',
 'Tech Mahindra is hiring an LWC Developer for Salesforce UI modernization projects.

Requirements:
- 3+ years LWC development
- Strong JavaScript/HTML/CSS
- Salesforce Lightning Design System (SLDS)
- Apex controllers and Wire Service
- Aura to LWC migration experience
- Performance optimization for Lightning pages',
 'full_time', 3, 6, 900000, 1600000, 'INR', 'yearly', 'remote', 'India', 'unknown', 'no',
 'https://careers.techmahindra.com/lwc-dev-001', 'https://careers.techmahindra.com/lwc-dev-001', 'TM-LWC-001',
 '2026-08-07T00:00:00Z', 'active'),

-- 24. Platform Engineer - Remote US/Canada
('b0000000-0000-0000-0000-000000000024', 'plat-eng-shopify-001', 'Senior Platform Engineer', 'senior platform engineer', 'Shopify', 'shopify.com',
 'Shopify is hiring a Senior Platform Engineer to build and maintain our commerce platform infrastructure.

Requirements:
- 5+ years infrastructure/platform engineering
- Ruby, Go, or Rust
- Kubernetes at scale
- Database performance tuning
- Distributed tracing and observability
- Capacity planning experience',
 'full_time', 5, 10, 130000, 190000, 'USD', 'yearly', 'remote', 'US/Canada', 'yes', 'no',
 'https://www.shopify.com/careers/plat-eng-001', 'https://www.shopify.com/careers/plat-eng-001', 'SHOP-PE-001',
 '2026-08-02T00:00:00Z', 'active'),

-- 25. Salesforce Marketing Cloud - Hybrid Delhi
('b0000000-0000-0000-0000-000000000025', 'sf-mc-ibm-001', 'Salesforce Marketing Cloud Developer', 'salesforce marketing cloud developer', 'IBM', 'ibm.com',
 'IBM is seeking a Salesforce Marketing Cloud Developer for digital marketing implementations.

Requirements:
- 3+ years Salesforce Marketing Cloud
- Journey Builder, Email Studio, Automation Studio
- AMPscript and SSJS
- Data Extensions and SQL queries in MC
- API integrations with Marketing Cloud
- Marketing Cloud Email Specialist certification preferred',
 'full_time', 3, 7, 1100000, 1900000, 'INR', 'yearly', 'hybrid', NULL, 'unknown', 'no',
 'https://www.ibm.com/careers/sf-mc-001', 'https://www.ibm.com/careers/sf-mc-001', 'IBM-SF-MC-001',
 '2026-08-04T00:00:00Z', 'active');

-------------------------------------------------------
-- JOB SOURCE MAPPINGS
-------------------------------------------------------

INSERT INTO public.job_source_mappings (job_id, source_id, source_url, external_job_id, first_seen_at, last_seen_at, is_active) VALUES
  -- Infosys SF Dev found on Naukri and LinkedIn
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'https://www.naukri.com/job/infosys-salesforce-dev-001', 'INF-SF-001', '2026-08-01T00:00:00Z', '2026-08-07T00:00:00Z', true),
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'https://www.linkedin.com/jobs/view/inf-sf-001', 'INF-SF-001-LI', '2026-08-02T00:00:00Z', '2026-08-07T00:00:00Z', true),
  -- Deloitte SF Arch on Greenhouse
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000004', 'https://boards.greenhouse.io/deloitte/jobs/sf-arch-001', 'DEL-SF-ARCH-001-GH', '2026-07-28T00:00:00Z', '2026-08-06T00:00:00Z', true),
  -- GitLab on Lever
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000005', 'https://jobs.lever.co/gitlab/fs-001', 'GL-FS-001-LV', '2026-08-03T00:00:00Z', '2026-08-07T00:00:00Z', true),
  -- TCS React on Naukri
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003', 'https://www.naukri.com/job/tcs-react-001', 'TCS-REACT-001-NK', '2026-08-05T00:00:00Z', '2026-08-07T00:00:00Z', true),
  -- Google ML on Google Careers
  ('b0000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000007', 'https://careers.google.com/jobs/ml-eng-001', 'GOOG-ML-001', '2026-07-25T00:00:00Z', '2026-08-06T00:00:00Z', true),
  -- Microsoft TL on Microsoft Careers and LinkedIn
  ('b0000000-0000-0000-0000-000000000018', 'a0000000-0000-0000-0000-000000000008', 'https://careers.microsoft.com/tech-lead-001', 'MSFT-TL-001', '2026-07-27T00:00:00Z', '2026-08-06T00:00:00Z', true),
  ('b0000000-0000-0000-0000-000000000018', 'a0000000-0000-0000-0000-000000000001', 'https://www.linkedin.com/jobs/view/msft-tl-001', 'MSFT-TL-001-LI', '2026-07-28T00:00:00Z', '2026-08-06T00:00:00Z', true),
  -- Vercel FE on RemoteOK
  ('b0000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000010', 'https://remoteok.com/jobs/vercel-fe-001', 'VCL-FE-001-ROK', '2026-08-06T00:00:00Z', '2026-08-07T00:00:00Z', true),
  -- Salesforce Careers for SF CPQ
  ('b0000000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-000000000009', 'https://careers.salesforce.com/related/capgemini-cpq-001', 'CAP-SF-CPQ-001-SF', '2026-08-03T00:00:00Z', '2026-08-07T00:00:00Z', true);

-------------------------------------------------------
-- JOB LOCATIONS
-------------------------------------------------------

INSERT INTO public.job_locations (job_id, country, state, city, remote_allowed, remote_region) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'India', NULL, NULL, true, 'India'),
  ('b0000000-0000-0000-0000-000000000002', 'India', 'Karnataka', 'Bangalore', false, NULL),
  ('b0000000-0000-0000-0000-000000000003', NULL, NULL, NULL, true, 'Worldwide'),
  ('b0000000-0000-0000-0000-000000000004', 'India', 'Maharashtra', 'Pune', false, NULL),
  ('b0000000-0000-0000-0000-000000000005', 'India', NULL, NULL, true, 'India'),
  ('b0000000-0000-0000-0000-000000000006', 'United States', NULL, NULL, true, 'US only'),
  ('b0000000-0000-0000-0000-000000000007', 'India', 'Karnataka', 'Bangalore', false, NULL),
  ('b0000000-0000-0000-0000-000000000008', NULL, NULL, NULL, true, 'Worldwide'),
  ('b0000000-0000-0000-0000-000000000009', 'India', 'Telangana', 'Hyderabad', false, NULL),
  ('b0000000-0000-0000-0000-000000000010', 'India', 'Maharashtra', 'Mumbai', false, NULL),
  ('b0000000-0000-0000-0000-000000000011', NULL, NULL, NULL, true, 'EMEA'),
  ('b0000000-0000-0000-0000-000000000012', 'India', NULL, NULL, true, 'India'),
  ('b0000000-0000-0000-0000-000000000013', 'India', 'Karnataka', 'Bangalore', false, NULL),
  ('b0000000-0000-0000-0000-000000000014', 'India', NULL, NULL, true, 'India'),
  ('b0000000-0000-0000-0000-000000000015', NULL, NULL, NULL, true, 'Worldwide'),
  ('b0000000-0000-0000-0000-000000000016', 'India', 'Maharashtra', 'Pune', false, NULL),
  ('b0000000-0000-0000-0000-000000000017', 'India', NULL, NULL, true, 'India'),
  ('b0000000-0000-0000-0000-000000000018', 'India', 'Karnataka', 'Bangalore', false, NULL),
  ('b0000000-0000-0000-0000-000000000019', 'India', 'Tamil Nadu', 'Chennai', false, NULL),
  ('b0000000-0000-0000-0000-000000000020', NULL, NULL, NULL, true, 'APAC'),
  ('b0000000-0000-0000-0000-000000000021', 'India', NULL, NULL, true, 'India'),
  ('b0000000-0000-0000-0000-000000000022', NULL, NULL, NULL, true, 'Worldwide'),
  ('b0000000-0000-0000-0000-000000000023', 'India', NULL, NULL, true, 'India'),
  ('b0000000-0000-0000-0000-000000000024', 'United States', NULL, NULL, true, 'US/Canada'),
  ('b0000000-0000-0000-0000-000000000024', 'Canada', NULL, NULL, true, 'US/Canada'),
  ('b0000000-0000-0000-0000-000000000025', 'India', 'Delhi', 'New Delhi', false, NULL);

-------------------------------------------------------
-- JOB SKILLS
-------------------------------------------------------

INSERT INTO public.job_skills (job_id, skill_name, is_required, proficiency_level) VALUES
  -- Job 1: Senior Salesforce Developer
  ('b0000000-0000-0000-0000-000000000001', 'Apex', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000001', 'Lightning Web Components', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000001', 'Salesforce APIs', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000001', 'SFDX', false, 'intermediate'),
  ('b0000000-0000-0000-0000-000000000001', 'Git', false, 'intermediate'),
  ('b0000000-0000-0000-0000-000000000001', 'CI/CD', false, 'intermediate'),

  -- Job 2: Salesforce Technical Architect
  ('b0000000-0000-0000-0000-000000000002', 'Salesforce Architecture', true, 'expert'),
  ('b0000000-0000-0000-0000-000000000002', 'MuleSoft', false, 'advanced'),
  ('b0000000-0000-0000-0000-000000000002', 'Integration Patterns', true, 'expert'),
  ('b0000000-0000-0000-0000-000000000002', 'Apex', true, 'expert'),
  ('b0000000-0000-0000-0000-000000000002', 'Large Data Volumes', true, 'advanced'),

  -- Job 3: Senior Full Stack Engineer
  ('b0000000-0000-0000-0000-000000000003', 'Ruby on Rails', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000003', 'Vue.js', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000003', 'PostgreSQL', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000003', 'CI/CD', true, 'intermediate'),
  ('b0000000-0000-0000-0000-000000000003', 'Git', true, 'advanced'),

  -- Job 4: React Developer
  ('b0000000-0000-0000-0000-000000000004', 'React', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000004', 'TypeScript', true, 'intermediate'),
  ('b0000000-0000-0000-0000-000000000004', 'Redux', false, 'intermediate'),
  ('b0000000-0000-0000-0000-000000000004', 'Jest', false, 'intermediate'),

  -- Job 5: Senior Cloud Engineer
  ('b0000000-0000-0000-0000-000000000005', 'AWS', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000005', 'Terraform', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000005', 'Kubernetes', true, 'intermediate'),
  ('b0000000-0000-0000-0000-000000000005', 'Docker', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000005', 'CI/CD', true, 'intermediate'),

  -- Job 9: Salesforce Administrator
  ('b0000000-0000-0000-0000-000000000009', 'Salesforce Administration', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000009', 'Flow Builder', true, 'intermediate'),
  ('b0000000-0000-0000-0000-000000000009', 'Reports & Dashboards', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000009', 'Apex', false, 'beginner'),

  -- Job 14: SFCC Developer
  ('b0000000-0000-0000-0000-000000000014', 'Salesforce Commerce Cloud', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000014', 'JavaScript', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000014', 'SFRA', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000014', 'ISML', true, 'intermediate'),

  -- Job 15: Frontend Engineer
  ('b0000000-0000-0000-0000-000000000015', 'React', true, 'expert'),
  ('b0000000-0000-0000-0000-000000000015', 'Next.js', true, 'expert'),
  ('b0000000-0000-0000-0000-000000000015', 'TypeScript', true, 'expert'),
  ('b0000000-0000-0000-0000-000000000015', 'Performance Optimization', true, 'advanced'),

  -- Job 16: Salesforce Integration Developer
  ('b0000000-0000-0000-0000-000000000016', 'Salesforce APIs', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000016', 'MuleSoft', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000016', 'REST', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000016', 'SOAP', true, 'intermediate'),
  ('b0000000-0000-0000-0000-000000000016', 'Apex', true, 'advanced'),

  -- Job 21: Salesforce CPQ
  ('b0000000-0000-0000-0000-000000000021', 'Salesforce CPQ', true, 'expert'),
  ('b0000000-0000-0000-0000-000000000021', 'Apex', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000021', 'Product Bundling', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000021', 'Vlocity', false, 'intermediate'),

  -- Job 23: LWC Developer
  ('b0000000-0000-0000-0000-000000000023', 'Lightning Web Components', true, 'expert'),
  ('b0000000-0000-0000-0000-000000000023', 'JavaScript', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000023', 'SLDS', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000023', 'Apex', true, 'intermediate'),
  ('b0000000-0000-0000-0000-000000000023', 'Aura', false, 'intermediate'),

  -- Job 25: Salesforce Marketing Cloud
  ('b0000000-0000-0000-0000-000000000025', 'Salesforce Marketing Cloud', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000025', 'AMPscript', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000025', 'SSJS', true, 'intermediate'),
  ('b0000000-0000-0000-0000-000000000025', 'Journey Builder', true, 'advanced'),
  ('b0000000-0000-0000-0000-000000000025', 'SQL', true, 'intermediate');
