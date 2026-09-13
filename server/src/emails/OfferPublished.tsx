import { Button, Heading, Hr, Section, Text } from '@react-email/components';
import * as React from 'react';
import { Offer } from '../models/offer.model';
import { isPromotionActive, sharedMaximumOrder } from '../models/offer.helper';
import { Layout } from './components/Layout';
import { UNIT_SUFFIX, formatPickupDate, formatPrice, formatTime } from './format';
import { appUrl, palette, styles } from './theme';

export interface OfferPublishedProps {
  offer: Offer;
  customerName?: string;
  unsubscribeUrl: string;
}

export const OfferPublished: React.FC<OfferPublishedProps> = ({
  offer,
  customerName,
  unsubscribeUrl,
}) => {
  // Customer deep link — /home reads ?offer=<uuid> and opens the booking form.
  const offerUrl = `${appUrl}/home?offer=${offer.uuid}`;

  return (
    <Layout preview={`Nouvelle offre : ${offer.name}`} unsubscribeUrl={unsubscribeUrl}>
      <Text style={styles.subtle}>Nouvelle offre dans le réseau des anges</Text>
      <Heading style={styles.h1}>{offer.name}</Heading>
      <Text style={styles.text}>Bonjour{customerName ? ` ${customerName}` : ''},</Text>
      {offer.description ? <Text style={styles.text}>{offer.description}</Text> : null}

      <Section style={styles.panel}>
        {offer.products.map((product, index) => (
          <Text key={`${product.name}-${index}`} style={styles.lineItem}>
            {product.name} — <strong>{formatPrice(product.unitPrice)}</strong>
            {UNIT_SUFFIX[product.unitType] ?? ''}
          </Text>
        ))}
        {isPromotionActive(offer) ? (
          <Text style={{ ...styles.text, margin: '8px 0 0' }}>
            🎉 Prix promotionnel de <strong>{formatPrice(offer.globalQuantities!.promotionPrice!)}</strong> si vous
            réservez la totalité du lot ({sharedMaximumOrder(offer)} max).
          </Text>
        ) : null}
        <Text style={{ ...styles.subtle, margin: '12px 0 0' }}>
          Retrait le <strong>{formatPickupDate(offer.pickupDate)}</strong> entre{' '}
          <strong>{formatTime(offer.pickupWindowStart)}</strong> et{' '}
          <strong>{formatTime(offer.pickupWindowEnd)}</strong>.
        </Text>
      </Section>

      <Button href={offerUrl} style={styles.button}>
        Voir l'offre et commander
      </Button>

      <Hr style={styles.hr} />
      <Text style={styles.subtle}>
        Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :{' '}
        <span style={{ color: palette.sage }}>{offerUrl}</span>
      </Text>
    </Layout>
  );
};

export default OfferPublished;
