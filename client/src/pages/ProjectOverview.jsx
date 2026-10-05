import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import ProjectDetail, { DetailHeader } from '../components/ProjectDetail.jsx';
import { ErrorBox, Loading, useAsync } from '../components/ui.jsx';

/** Detailed Overview — deeper reference view, not optimised for the live call. */
export default function ProjectOverview() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, ref } = useSession();
  const d = useAsync(() => api.get(`/api/explorer/projects/${id}`), [id]);
  const labels = Object.fromEntries((ref?.master_values || []).map((v) => [v.id, v.label]));
  if (d.loading) return <Loading />;
  if (d.error) return <div className="page"><ErrorBox error={d.error} /></div>;
  const p = d.data;
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="linkbtn small" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}>Back to search</button>
      </div>
      <div className="panel panel-pad">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <DetailHeader d={p} />
          <div className="row">
            <button className="btn sm" onClick={() => window.print()}>Print</button>
            {can('project.edit') && <Link className="btn sm primary" to={`/manage/${p.id}`}>Edit project</Link>}
          </div>
        </div>
        <ProjectDetail d={p} full masterLabels={labels} />
      </div>
    </div>
  );
}
