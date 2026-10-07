// Shared brand tokens for every transactional email.
// Palette mirrors client/tailwind.config.js so mail matches the app.
export const palette = {
  green: '#3D4228', // primary
  sage: '#7A8560',
  gold: '#E8B94A',
  cream: '#FDF8F0',
  rose: '#D96C5A',
  tan: '#D49A3E',
  ink: '#2E2E2E', // body text
  muted: '#8A8778', // secondary text
  line: '#E7E1D4', // hairline borders
  white: '#FFFFFF',
};

// Public origin of the customer-facing app; links in emails point here.
export const appUrl = (process.env.clientOrigin || 'https://clickange.etappli.fr').replace(/\/$/, '');

// logo_full.jpg carries the wordmark + tagline on a white ground, so it sits
// seamlessly on the white content card.
export const logoUrl = `${appUrl}/logo_full.jpg`;

export const fontStack =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const styles = {
  main: {
    backgroundColor: palette.cream,
    fontFamily: fontStack,
    margin: 0,
    padding: '24px 0',
  },
  card: {
    backgroundColor: palette.white,
    borderRadius: '14px',
    border: `1px solid ${palette.line}`,
    maxWidth: '600px',
    margin: '0 auto',
    overflow: 'hidden' as const,
  },
  header: {
    padding: '32px 24px 8px',
    textAlign: 'center' as const,
  },
  logo: {
    width: '190px',
    height: 'auto',
    margin: '0 auto',
  },
  content: {
    padding: '8px 40px 32px',
  },
  h1: {
    color: palette.green,
    fontSize: '22px',
    fontWeight: 700,
    lineHeight: '1.3',
    margin: '16px 0 4px',
  },
  h2: {
    color: palette.green,
    fontSize: '18px',
    fontWeight: 700,
    lineHeight: '1.3',
    margin: '0 0 4px',
  },
  // free text typed by the manager (see ManagerMessage)
  message: {
    color: palette.ink,
    fontSize: '15px',
    lineHeight: '1.6',
    margin: '12px 0',
  },
  text: {
    color: palette.ink,
    fontSize: '15px',
    lineHeight: '1.6',
    margin: '12px 0',
  },
  subtle: {
    color: palette.muted,
    fontSize: '13px',
    lineHeight: '1.6',
    margin: '12px 0',
  },
  button: {
    backgroundColor: palette.green,
    borderRadius: '10px',
    color: palette.white,
    fontSize: '15px',
    fontWeight: 700,
    textDecoration: 'none',
    textAlign: 'center' as const,
    display: 'block',
    padding: '14px 24px',
  },
  panel: {
    backgroundColor: palette.cream,
    border: `1px solid ${palette.line}`,
    borderRadius: '12px',
    padding: '18px 20px',
    margin: '20px 0',
  },
  lineItem: {
    color: palette.ink,
    fontSize: '15px',
    lineHeight: '1.5',
    margin: '6px 0',
  },
  totalRow: {
    color: palette.green,
    fontSize: '16px',
    fontWeight: 700,
    margin: '12px 0 0',
    paddingTop: '12px',
    borderTop: `1px solid ${palette.line}`,
  },
  hr: {
    borderColor: palette.line,
    margin: '28px 0 16px',
  },
  footer: {
    color: palette.muted,
    fontSize: '12px',
    lineHeight: '1.6',
    textAlign: 'center' as const,
    maxWidth: '600px',
    margin: '16px auto 0',
    padding: '0 24px',
  },
  footerLink: {
    color: palette.sage,
    textDecoration: 'underline',
  },
} as const;
