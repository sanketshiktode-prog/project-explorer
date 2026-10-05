import { useSession } from '../session.jsx';

export default function Help() {
  const { can } = useSession();
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head"><div><h1>How to use Project Explorer</h1></div></div>
      <div className="panel panel-pad stack">
        <h3>On a customer call</h3>
        <ol className="bul" style={{ fontSize: 'var(--step-0)' }}>
          <li>Type an area, developer or project name in the search box, or pick filters on the left — City, Location, Configuration and Budget first.</li>
          <li>Budget and carpet area accept quick bands <i>or</i> the slider. You can also type “1.2 Cr” or “85 L” in the Min / Max boxes.</li>
          <li>Each result shows only the configurations that fit. A green bar means every requirement is met by the same configuration; amber means it is close (for example 5% above budget) and the reason is shown underneath.</li>
          <li>Click a result or a map pin to open the details panel: configurations, towers, parking, amenities, connectivity, USPs, payment plans, current offers, EOI and objection answers.</li>
          <li>Use “Detailed overview” when you need everything about one project, or to print it.</li>
          <li>If a project says “Needs re-check”, its information has not been updated recently — confirm price and possession with the developer before committing.</li>
          <li>The page link keeps your filters, so you can bookmark or share a search.</li>
        </ol>
        {can('project.edit') && (<>
          <h3>Entering and updating projects</h3>
          <ol className="bul" style={{ fontSize: 'var(--step-0)' }}>
            <li>Projects → New project. Start with the name, developer and location; the system checks for existing projects before creating one.</li>
            <li>Work through the steps in any order. Every step saves on its own — use “Save” on each step; you can leave and come back (drafts are kept).</li>
            <li>Mark a field as <b>N/A</b> when it does not apply and <b>Unknown</b> when you do not know yet. Leaving it blank means “not provided”.</li>
            <li>Towers: create several towers at once, then use “Apply to selected towers” for shared details. Change any single tower afterwards — its own values are kept.</li>
            <li>The right-hand panel lists errors (must fix), warnings (unusual) and missing information. Submit for review when ready; a reviewer verifies and publishes it to sales.</li>
            <li>If someone else changed the same field while you were editing, you will be shown both values and asked which to keep — nobody’s work is silently overwritten.</li>
          </ol>
        </>)}
      </div>
    </div>
  );
}
