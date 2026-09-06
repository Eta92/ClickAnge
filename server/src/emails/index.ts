import { render } from '@react-email/render';
import * as React from 'react';

export { BookingConfirmed } from './BookingConfirmed';
export { OfferPublished } from './OfferPublished';
export { VerificationCode } from './VerificationCode';

export interface RenderedEmail {
  html: string;
  text: string;
}

// Renders a template to both the HTML and plain-text bodies Resend expects.
export async function renderEmail(element: React.ReactElement): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { html, text };
}
