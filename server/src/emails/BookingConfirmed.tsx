import { Button, Heading, Hr, Section, Text } from '@react-email/components';
import * as React from 'react';
import { Booking } from '../models/booking.model';
import { Offer } from '../models/offer.model';
import { buildBookingRecap } from './bookingLines';
import { Layout } from './components/Layout';
import { ManagerMessage } from './components/ManagerMessage';
import { formatPickupDate, formatPrice, formatTime } from './format';
import { appUrl, palette, styles } from './theme';

// what one customer booked on one of the closed offers
export interface ConfirmedOrder {
  offer: Offer;
  bookings: Array<Booking>;
}

export interface BookingConfirmedProps {
  // only the closed offers this customer actually booked on
  orders: Array<ConfirmedOrder>;
  // extra details the manager wrote for the whole batch of closed offers
  message?: string;
  customerName?: string;
  unsubscribeUrl: string;
}

const OrderRecap: React.FC<{ order: ConfirmedOrder; showName: boolean }> = ({ order, showName }) => {
  const { offer } = order;
  const recap = buildBookingRecap(offer, order.bookings);

  return (
    <>
      <Section style={styles.panel}>
        {showName ? (
          <Heading as="h2" style={styles.h2}>
            {offer.name}
          </Heading>
        ) : null}
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

      <Section style={{ ...styles.panel, backgroundColor: palette.white, borderColor: palette.sage }}>
        <Text style={{ ...styles.text, margin: 0 }}>
          Retrait le <strong>{formatPickupDate(offer.pickupDate)}</strong> entre <strong>{formatTime(offer.pickupWindowStart)}</strong> et{' '}
          <strong>{formatTime(offer.pickupWindowEnd)}</strong>.
        </Text>
      </Section>
    </>
  );
};

export const BookingConfirmed: React.FC<BookingConfirmedProps> = ({ orders, message, customerName, unsubscribeUrl }) => {
  const single = orders.length === 1 ? orders[0].offer : null;
  const grandTotal = orders.reduce((sum, order) => sum + buildBookingRecap(order.offer, order.bookings).total, 0);
  // The offers are closed by now; send the customer to their bookings list.
  const bookingsUrl = `${appUrl}/home`;

  return (
    <Layout
      preview={single ? `Commande confirmée : ${single.name}` : `Commandes confirmées : ${orders.map((o) => o.offer.name).join(', ')}`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Text style={styles.subtle}>{single ? 'Commande confirmée' : 'Commandes confirmées'}</Text>
      <Heading style={styles.h1}>{single ? single.name : `Vos ${orders.length} commandes`}</Heading>
      <Text style={styles.text}>Bonjour{customerName ? ` ${customerName}` : ''},</Text>
      <Text style={styles.text}>
        {single ? (
          <>
            L'offre <strong>{single.name}</strong> est maintenant fermée et votre commande est confirmée.
          </>
        ) : (
          <>Les offres suivantes sont maintenant fermées et vos commandes sont confirmées.</>
        )}
      </Text>
      <ManagerMessage message={message} />

      {orders.map((order) => (
        <OrderRecap key={order.offer.uuid} order={order} showName={!single} />
      ))}

      {!single && grandTotal > 0 ? <Text style={styles.totalRow}>Total de vos commandes : {formatPrice(grandTotal)}</Text> : null}

      <Button href={bookingsUrl} style={{ ...styles.button, marginTop: '20px' }}>
        Voir mes commandes
      </Button>

      <Hr style={styles.hr} />
      <Text style={styles.subtle}>Merci et à bientôt chez Click'Ange.</Text>
    </Layout>
  );
};

export default BookingConfirmed;
