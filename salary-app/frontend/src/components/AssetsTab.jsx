import { STANDALONE } from '../api.js';
import Assets from './people/Assets.jsx';

/**
 * Assets, as their own tab.
 *
 * They sat under People, which was the wrong place and Dinesh said so: an
 * asset belongs to the company, not to a person. Most of them are nobody's -
 * the office printer, the furniture, the spare SIM - and a register you reach
 * through a tab about staff records implies everything on it is issued to
 * somebody.
 *
 * So the register leads, with its own three views: everything the company
 * owns, who is holding what, and a stock take. What somebody was handed is one
 * view of it rather than the way in, and it also shows on that person's own
 * record.
 */
export default function AssetsTab({
  employees,
  companies,
  period,
  me,
  scanned,
  onScanned,
  onError,
  onReload,
}) {
  return (
    <>
      {/*
        * This used to be the whole tab: one card saying the register needs the
        * server. It does not. An asset, a handover, a stock take and a service
        * bill are records, and this file already keeps records. One thing
        * genuinely needs a server and says so where it is - a PHOTOGRAPH is a
        * file, and a file cannot live inside an HTML page.
        */}
      {STANDALONE && (
        <p className="muted small">
          Offline: the register, codes and labels, handovers, the stock take and the service
          history all work in this file. What needs the server version is a photograph of an
          asset — that is a file, and a file cannot live inside an HTML page.
        </p>
      )}
    <Assets
      employees={employees}
      companies={companies}
      period={period}
      me={me}
      scanned={scanned}
      onScanned={onScanned}
      onError={onError}
      onReload={onReload}
    />
    </>
  );
}
