export default function SectionHeader({ title, subtitle }) {
  return (
    <div className="section-header">
      <div className="section-title">{title}</div>
      {subtitle && <div className="section-subtitle">{subtitle}</div>}
    </div>
  );
}
