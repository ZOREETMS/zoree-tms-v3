import BidStatusBadge from "./BidStatusBadge";

export default function RfqTable({ bids, onViewBids }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">RFQ Board</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>RFQ #</th>
              <th>Lane</th>
              <th>Volume (loads/mo)</th>
              <th>Deadline</th>
              <th>Bids</th>
              <th>Best Bid</th>
              <th>Incumbent</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {bids.map((b) => (
              <tr key={b.id}>
                <td>
                  <span className="mono" style={{ color: "var(--accent)", fontWeight: 700 }}>
                    {b.id}
                  </span>
                </td>
                <td>{b.lane}</td>
                <td className="mono">{b.volume} loads</td>
                <td className="mono">{b.deadline}</td>
                <td className="mono">{b.bids}</td>
                <td className="mono" style={{ color: "var(--green)", fontWeight: 700 }}>
                  {b.bestBid}
                </td>
                <td>{b.incumbent}</td>
                <td>
                  <BidStatusBadge status={b.status} />
                </td>
                <td>
                  {b.status === "Open" ? (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => onViewBids(b.id)}
                    >
                      View Bids
                    </button>
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--green)" }}>
                      ✓ Awarded
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {bids.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", color: "var(--text3)", padding: 32 }}>
                  No RFQs found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
