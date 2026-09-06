import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';
import { appUrl, logoUrl, styles } from '../theme';

interface LayoutProps {
  // inbox preview line (grey text after the subject)
  preview: string;
  // optional unsubscribe link target; when set, renders the footer opt-out row
  unsubscribeUrl?: string;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ preview, unsubscribeUrl, children }) => (
  <Html lang="fr">
    <Head>
      <meta name="color-scheme" content="light" />
      <meta name="supported-color-schemes" content="light" />
    </Head>
    <Preview>{preview}</Preview>
    <Body style={styles.main}>
      <Container style={styles.card}>
        <Section style={styles.header}>
          <Link href={appUrl}>
            <Img src={logoUrl} alt="Click'Ange" style={styles.logo} />
          </Link>
        </Section>
        <Section style={styles.content}>{children}</Section>
      </Container>

      <Section>
        <Text style={styles.footer}>
          Click'Ange — Réservez · Récupérez · Savourez
        </Text>
        {unsubscribeUrl ? (
          <Text style={styles.footer}>
            Vous recevez cet email car vous êtes abonné aux notifications de Click'Ange.{' '}
            <Link href={unsubscribeUrl} style={styles.footerLink}>
              Se désabonner
            </Link>
          </Text>
        ) : null}
      </Section>
      <Hr style={{ ...styles.hr, maxWidth: '600px' }} />
    </Body>
  </Html>
);
