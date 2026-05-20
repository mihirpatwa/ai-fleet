// Security findings (server component). Flattened from security-auditor task
// outputs via lib/db; severity filter is client-side in <SecurityView>.
import { projects, securityFindings } from '@/lib/db';
import { getActiveProject } from '@/lib/activeProject';
import { Section } from '@/components/Shell/Section';
import { SecurityView } from '@/components/security/SecurityView';

export const dynamic = 'force-dynamic';

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const sp = await searchParams;
  const project = await getActiveProject(sp.project, projects()[0]);
  const findings = securityFindings(project);
  const blocking = findings.filter(
    (f) => f.blocking && (f.severity === 'high' || f.severity === 'critical'),
  ).length;

  return (
    <Section
      title="Security findings"
      subtitle={`${findings.length} finding(s) · ${blocking} blocking`}
      breadcrumb={[{ title: 'Security' }]}
    >
      <SecurityView findings={findings} />
    </Section>
  );
}
