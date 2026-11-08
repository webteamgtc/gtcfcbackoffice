/** Shown while a back-office page is being read from the database. */
export default function AdminLoading() {
  return (
    <div className="ad-loading" role="status" aria-label="Loading">
      <div className="ad-skel ad-skel-hero" />
      <div className="ad-skel-row">
        <div className="ad-skel" />
        <div className="ad-skel" />
        <div className="ad-skel" />
        <div className="ad-skel" />
      </div>
      <div className="ad-skel ad-skel-table" />
    </div>
  );
}
