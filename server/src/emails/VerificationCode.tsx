import { Heading, Section, Text } from '@react-email/components';
import * as React from 'react';
import { Layout } from './components/Layout';
import { palette, styles } from './theme';

export interface VerificationCodeProps {
  code: string;
}

export const VerificationCode: React.FC<VerificationCodeProps> = ({ code }) => (
  <Layout preview={`Votre code de vérification Click'Ange : ${code}`}>
    <Heading style={styles.h1}>Confirmez votre adresse email</Heading>
    <Text style={styles.text}>
      Voici votre code de vérification. Saisissez-le dans l'application pour activer votre compte.
    </Text>

    <Section
      style={{
        ...styles.panel,
        textAlign: 'center',
        borderColor: palette.gold,
      }}
    >
      <Text
        style={{
          color: palette.green,
          fontSize: '34px',
          fontWeight: 700,
          letterSpacing: '10px',
          margin: 0,
        }}
      >
        {code}
      </Text>
    </Section>

    <Text style={styles.subtle}>
      Ce code expire dans 10 minutes. Si vous n'êtes pas à l'origine de cette demande, vous pouvez
      ignorer cet email.
    </Text>
  </Layout>
);

export default VerificationCode;
