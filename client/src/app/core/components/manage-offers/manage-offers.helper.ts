import { BulkOfferAction, Offer, OfferStatus } from '../../models/offer.model';

/** The status each grouped action moves an offer to. */
export const TARGET_STATUS: Record<BulkOfferAction, OfferStatus> = {
  publish: OfferStatus.OPEN,
  close: OfferStatus.CLOSED,
  archive: OfferStatus.COMPLETED,
};

/** The status an offer is normally in before each action — anything else is off-cycle. */
const EXPECTED_STATUS: Record<BulkOfferAction, OfferStatus> = {
  publish: OfferStatus.DRAFT,
  close: OfferStatus.OPEN,
  archive: OfferStatus.CLOSED,
};

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  [OfferStatus.DRAFT]: 'Brouillon',
  [OfferStatus.OPEN]: 'Ouverte',
  [OfferStatus.CLOSED]: 'Fermée',
  [OfferStatus.COMPLETED]: 'Terminée',
};

/**
 * What the manager should double-check before applying `action` to `offer`:
 * an off-cycle status, a re-sent email, or dates already in the past.
 */
export function bulkActionWarnings(
  offer: Offer,
  action: BulkOfferAction,
  notify: boolean,
  now: number,
): Array<string> {
  const warnings: Array<string> = [];
  const status = offer.status;

  if (status !== EXPECTED_STATUS[action]) {
    warnings.push(offCycleWarning(action, status, notify));
  }

  if (action === 'publish') {
    if (offer.pickupWindowEnd < now) {
      warnings.push('La date de retrait est déjà passée.');
    }
    if (offer.autoCloseAt != null && offer.autoCloseAt <= now) {
      warnings.push(
        'La date de fermeture automatique est dépassée : elle sera supprimée.',
      );
    }
  }

  return warnings;
}

function offCycleWarning(
  action: BulkOfferAction,
  status: OfferStatus,
  notify: boolean,
): string {
  const reopened =
    'Elle sera rouverte et les réservations redeviendront modifiables.';
  switch (action) {
    case 'publish':
      if (status === OfferStatus.OPEN) {
        return notify
          ? 'Déjà ouverte : elle sera annoncée une nouvelle fois.'
          : 'Déjà ouverte.';
      }
      return `${OFFER_STATUS_LABELS[status]}. ${reopened}`;
    case 'close':
      if (status === OfferStatus.DRAFT) {
        return "Brouillon jamais publié : aucun client n'a pu réserver.";
      }
      return notify
        ? `${OFFER_STATUS_LABELS[status]} : les confirmations seront envoyées une nouvelle fois.`
        : `${OFFER_STATUS_LABELS[status]} : elle repassera à « Fermée ».`;
    case 'archive':
      if (status === OfferStatus.OPEN) {
        return 'Encore ouverte : les réservations en attente ne seront pas confirmées et aucun e-mail ne sera envoyé.';
      }
      if (status === OfferStatus.DRAFT) {
        return 'Brouillon jamais publié.';
      }
      return 'Déjà terminée.';
  }
}
