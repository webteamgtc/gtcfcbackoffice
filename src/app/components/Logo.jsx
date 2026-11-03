import Image from 'next/image';

const LOGOS = {
  // blue logo for light backgrounds
  main: 'https://gtcfx-bucket.s3.ap-southeast-1.amazonaws.com/logo/main-logo.webp',
  // white logo for dark backgrounds
  footer: 'https://gtcfx-bucket.s3.ap-southeast-1.amazonaws.com/logo/footer-logo.webp'
};

export default function Logo({ variant = 'main', width = 160, priority = false, className }) {
  return (
    <Image
      src={LOGOS[variant]}
      alt="GTC — Trusted | Regulated | Global"
      width={width}
      height={Math.round((width * 286) / 800)}
      priority={priority}
      className={className}
    />
  );
}
