// Brand mark for the sidebar and the login card. The Zoree "Z" and an
// original Kestrel Bay mark (a kestrel's wing over the bay's waves).
import { BRAND } from "../../config/brand";

function KestrelMark({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 62 62" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="kbring" x1="0" y1="0" x2="62" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F97316" /><stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>
      </defs>
      <circle cx="31" cy="31" r="29" fill="#0F1E36" stroke="url(#kbring)" strokeWidth="2" />
      {/* wing: a swept chevron, rising right */}
      <path d="M12 30 L31 19 L50 13 L39 26 L31 25 Z" fill="#F97316" />
      <path d="M31 25 L39 26 L33 32 Z" fill="#FDBA74" />
      {/* the bay: two waves */}
      <path d="M12 39 q5 -4 10 0 t10 0 t10 0 t10 0" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" fill="none" />
      <path d="M16 47 q4 -3 8 0 t8 0 t8 0 t7 0" stroke="#7DD3FC" strokeWidth="2.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function ZoreeMark({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 62 62" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="zlogin" x1="0" y1="0" x2="62" y2="62" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#38BDF8" /><stop offset="100%" stopColor="#818CF8" /></linearGradient></defs>
      <circle cx="31" cy="31" r="29" fill="#111827" stroke="url(#zlogin)" strokeWidth="2" />
      <line x1="15" y1="18" x2="47" y2="18" stroke="white" strokeWidth="5" strokeLinecap="round" />
      <line x1="47" y1="18" x2="15" y2="44" stroke="white" strokeWidth="5" strokeLinecap="round" />
      <line x1="15" y1="44" x2="47" y2="44" stroke="white" strokeWidth="5" strokeLinecap="round" />
      <circle cx="47" cy="18" r="5" fill="#38BDF8" />
    </svg>
  );
}

export default function BrandMark({ size = 56 }) {
  return BRAND.key === "kestrel" ? <KestrelMark size={size} /> : <ZoreeMark size={size} />;
}
