import { Button, Heading, Hr, Section, Text } from '@react-email/components';
import * as React from 'react';
import { Offer } from '../models/offer.model';
import { isPromotionActive, sharedMaximumOrder } from '../models/offer.helper';
import { Layout } from './components/Layout';
import { ManagerMessage } from './components/ManagerMessage';
import { UNIT_SUFFIX, formatPickupDate, formatPrice, formatTime } from './format';
import { appUrl, palette, styles } from './theme';

export interface OfferPublishedProps {
  // one offer, or several announced together by the manager
  offers: Array<Offer>;
  // extra details the manager wrote for the whole announcement
  message?: string;
  customerName?: string;
  unsubscribeUrl: string;
}

// Customer deep link — /home reads ?offer=<uuid> and opens the booking form.
const offerUrlOf = (offer: Offer): string => `${appUrl}/home?offer=${offer.uuid}`;

const OfferDetails: React.FC<{ offer: Offer }> = ({ offer }) => (
  <>
    {offer.products.map((product, index) => (
      <Text key={`${product.name}-${index}`} style={styles.lineItem}>
        {product.name} — <strong>{formatPrice(product.unitPrice)}</strong>
        {UNIT_SUFFIX[product.unitType] ?? ''}
      </Text>
    ))}
    {isPromotionActive(offer) ? (
      <Text style={{ ...styles.text, margin: '8px 0 0' }}>
        🎉 Prix promotionnel de <strong>{formatPrice(offer.globalQuantities!.promotionPrice!)}</strong> si vous réservez la totalité du lot
        ({sharedMaximumOrder(offer)} max).
      </Text>
    ) : null}
    <Text style={{ ...styles.subtle, margin: '12px 0 0' }}>
      Retrait le <strong>{formatPickupDate(offer.pickupDate)}</strong> entre <strong>{formatTime(offer.pickupWindowStart)}</strong> et{' '}
      <strong>{formatTime(offer.pickupWindowEnd)}</strong>.
    </Text>
  </>
);

export const OfferPublished: React.FC<OfferPublishedProps> = ({ offers, message, customerName, unsubscribeUrl }) => {
  const single = offers.length === 1 ? offers[0] : null;
  const fallbackUrl = single ? offerUrlOf(single) : `${appUrl}/home`;
  const greeting = <Text style={styles.text}>Bonjour{customerName ? ` ${customerName}` : ''},</Text>;

  return (
    <Layout
      preview={single ? `Nouvelle offre : ${single.name}` : `Nouvelles offres : ${offers.map((o) => o.name).join(', ')}`}
      unsubscribeUrl={unsubscribeUrl}
    >
      {single ? (
        <>
          <Text style={styles.subtle}>Nouvelle offre dans le réseau des anges</Text>
          <Heading style={styles.h1}>{single.name}</Heading>
          {greeting}
          <ManagerMessage message={message} />
          {single.description ? <Text style={styles.text}>{single.description}</Text> : null}
          <Section style={styles.panel}>
            <OfferDetails offer={single} />
          </Section>
          <Button href={offerUrlOf(single)} style={styles.button}>
            Voir l'offre et commander
          </Button>
        </>
      ) : (
        <>
          <Text style={styles.subtle}>Nouvelles offres dans le réseau des anges</Text>
          <Heading style={styles.h1}>{offers.length} nouvelles offres</Heading>
          {greeting}
          <ManagerMessage message={message} />
          {offers.map((offer) => (
            <Section key={offer.uuid} style={styles.panel}>
              <Heading as="h2" style={styles.h2}>
                {offer.name}
              </Heading>
              {offer.description ? <Text style={{ ...styles.text, margin: '4px 0 8px' }}>{offer.description}</Text> : null}
              <OfferDetails offer={offer} />
              <Button href={offerUrlOf(offer)} style={{ ...styles.button, marginTop: '16px' }}>
                Voir l'offre et commander
              </Button>
            </Section>
          ))}
        </>
      )}

      <Hr style={styles.hr} />
      <Text style={styles.subtle}>
        Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur : <span style={{ color: palette.sage }}>{fallbackUrl}</span>
      </Text>
    </Layout>
  );
};

export default OfferPublished;
