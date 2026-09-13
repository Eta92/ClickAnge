import { Button, Heading, Hr, Section, Text } from '@react-email/components';
import * as React from 'react';
import { Booking } from '../models/booking.model';
import { Offer } from '../models/offer.model';
import { buildBookingRecap } from './bookingLines';
import { Layout } from './components/Layout';
import { formatPickupDate, formatPrice, formatTime } from './format';
import { appUrl, palette, styles } from './theme';

export interface BookingConfirmedProps {
  offer: Offer;
  bookings: Array<Booking>;
  customerName?: string;
  unsubscribeUrl: string;
}

export const BookingConfirmed: React.FC<BookingConfirmedProps> = ({
  offer,
  bookings,
  customerName,
  unsubscribeUrl,
}) => {
  const recap = buildBookingRecap(offer, bookings);
  // The offer is closed by now; send the customer to their bookings list.
  const bookingsUrl = `${appUrl}/home`;

  return (
    <Layout preview={`Commande confirmée : ${offer.name}`} unsubscribeUrl={unsubscribeUrl}>
      <Text style={styles.subtle}>Commande confirmée</Text>
      <Heading style={styles.h1}>{offer.name}</Heading>
      <Text style={styles.text}>Bonjour{customerName ? ` ${customerName}` : ''},</Text>
      <Text style={styles.text}>
        L'offre <strong>{offer.name}</strong> est maintenant fermée et votre commande est confirmée.
      </Text>

      <Section style={styles.panel}>
        <Text style={{ ...styles.subtle, margin: '0 0 8px' }}>Votre commande</Text>
        {recap.lines.map((line, index) => (
          <Text key={`${line.label}-${index}`} style={styles.lineItem}>
            {line.label}
            {line.total != null ? (
              <>
                {' — '}
                <strong>{formatPrice(line.total)}</strong>
              </>
            ) : null}
          </Text>
        ))}
        {recap.total > 0 ? (
          <Text style={styles.totalRow}>
            Prix total : {formatPrice(recap.total)}
            {recap.promotionApplied ? ' (prix promotionnel)' : ''}
          </Text>
        ) : null}
        {recap.note ? (
          <Text style={{ ...styles.subtle, margin: '12px 0 0' }}>
            Votre note : <em>{recap.note}</em>
          </Text>
        ) : null}
      </Section>

      <Section
        style={{ ...styles.panel, backgroundColor: palette.white, borderColor: palette.sage }}
      >
        <Text style={{ ...styles.text, margin: 0 }}>
          Retrait le <strong>{formatPickupDate(offer.pickupDate)}</strong> entre{' '}
          <strong>{formatTime(offer.pickupWindowStart)}</strong> et{' '}
          <strong>{formatTime(offer.pickupWindowEnd)}</strong>.
        </Text>
      </Section>

      <Button href={bookingsUrl} style={styles.button}>
        Voir mes commandes
      </Button>

      <Hr style={styles.hr} />
      <Text style={styles.subtle}>Merci et à bientôt chez Click'Ange.</Text>
    </Layout>
  );
};

export default BookingConfirmed;
