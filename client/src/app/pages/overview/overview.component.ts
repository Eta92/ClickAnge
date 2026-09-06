import { Component, OnInit, OnDestroy, computed, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DateTime } from 'luxon';
import { Booking, BookingStatus } from '../../core/models/booking.model';
import { Offer, OfferStatus } from '../../core/models/offer.model';
import { BookingService } from '../../core/services/booking.service';

@Component({
  standalone: false,
  selector: 'app-overview',
  templateUrl: './overview.component.html',
  styleUrls: ['./overview.component.scss'],
})
export class OverviewComponent implements OnInit, OnDestroy {
  offerId: string | null = null;
  offer: Offer | null = null;
  bookings = signal<Array<Booking>>([]);
  loading = signal(false);
  expandedBookingIds = signal<Set<string>>(new Set());
  multiProductBookingIds = computed(() =>
    this.bookings()
      .filter((b) => b.purchases.length > 1)
      .map((b) => b.uuid),
  );
  allExpanded = computed(() => {
    const ids = this.multiProductBookingIds();
    if (ids.length === 0) return false;
    const expanded = this.expandedBookingIds();
    return ids.every((id) => expanded.has(id));
  });

  // embedded offer-form state
  showOfferForm = false;

  constructor(
    private route: ActivatedRoute,
    private bookingService: BookingService,
  ) {}

  ngOnInit(): void {
    this.offerId = this.route.snapshot.paramMap.get('offerId');

    if (this.offerId) {
      this.loadOffer();
      this.loadBookings();

      // Listen for real-time updates to bookings
      this.bookingService.cancelledBookings$.subscribe(() => {
        // Refresh the bookings list when a booking is cancelled
        this.loadBookings();
      });

      // Listen for new bookings being created (if needed)
      // This would require additional socket event handling in the service
    }
  }

  ngOnDestroy(): void {
    // No need for explicit cleanup since we're using signals now
  }

  loadOffer(): void {
    if (!this.offerId) return;

    this.bookingService.getOffer(this.offerId).subscribe({
      next: (offer) => {
        this.offer = offer;
      },
      error: (err) => {
        console.error('Failed to load offer:', err);
      },
    });
  }

  loadBookings(): void {
    if (!this.offerId) return;

    this.loading.set(true);

    this.bookingService.getBookingsForOffer(this.offerId).subscribe({
      next: (bookings) => {
        this.bookings.set(bookings);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load bookings:', err);
        this.bookings.set([]);
        this.loading.set(false);
      },
    });
  }

  onEditOffer(): void {
    this.showOfferForm = true;
  }

  onOfferSaved(offer: Offer): void {
    this.offer = offer;
    this.showOfferForm = false;
  }

  onOfferCancelled(): void {
    this.showOfferForm = false;
  }

  exportExcel(): void {
    // One column per product, in the offer's product order, with any extra
    // product names found in bookings appended afterwards.
    const productNames = [
      ...(this.offer?.products.map((p) => p.name) ?? []),
    ];
    for (const b of this.bookings()) {
      for (const purchase of b.purchases) {
        if (!productNames.includes(purchase.name)) {
          productNames.push(purchase.name);
        }
      }
    }

    const rows = this.bookings().map((b) => {
      const quantities = new Map(
        b.purchases.map((p) => [p.name, p.quantity]),
      );
      return [
        b.customerName ?? '',
        b.customerEmail,
        b.customerPhone ?? '',
        b.status === BookingStatus.CONFIRMED
          ? 'Confirmé'
          : b.status === BookingStatus.CANCELLED
            ? 'Annulé'
            : 'En attente',
        b.note ?? '',
        DateTime.fromMillis(b.confirmedAt || b.createdAt).toFormat(
          'dd/MM/yyyy HH:mm',
        ),
        ...productNames.map((name) =>
          quantities.has(name) ? String(quantities.get(name)) : '',
        ),
      ];
    });

    const header = [
      'Nom',
      'Email',
      'Téléphone',
      'Statut',
      'Note',
      'Date',
      ...productNames,
    ];

    // Secondary header line with totals.
    const allBookings = this.bookings();
    const doneCount = allBookings.filter(
      (b) =>
        b.status === BookingStatus.FULFILLED ||
        b.status === BookingStatus.CANCELLED,
    ).length;
    const lastEdition = allBookings.reduce(
      (max, b) => Math.max(max, b.updatedAt || b.confirmedAt || b.createdAt),
      0,
    );
    const totals = [
      String(allBookings.length),
      '',
      '',
      `${doneCount}/${allBookings.length}`,
      '',
      lastEdition
        ? DateTime.fromMillis(lastEdition).toFormat('dd/MM/yyyy HH:mm')
        : '',
      ...productNames.map((name) =>
        String(
          allBookings.reduce(
            (sum, b) =>
              sum +
              b.purchases
                .filter((p) => p.name === name)
                .reduce((s, p) => s + p.quantity, 0),
            0,
          ),
        ),
      ),
    ];

    const csv = [header, totals, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob(['\uFEFF' + csv], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ClickAnge-${this.offer!.name}-${DateTime.now().toFormat("dd.MM.yyyy-HH'h'mm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Human-readable "name x qty, name x qty" summary of a booking's purchases */
  formatPurchases(booking: Booking): string {
    return booking.purchases
      .map((purchase) => `${purchase.name} x${purchase.quantity}`)
      .join(', ');
  }

  /** Unit label (e.g. "kilogramme") for a product, looked up from the offer's products */
  getProductUnit(productName: string): string {
    return (
      this.offer?.products.find((p) => p.name === productName)?.unitType ?? ''
    );
  }

  isBookingExpanded(booking: Booking): boolean {
    return this.expandedBookingIds().has(booking.uuid);
  }

  toggleBookingExpand(booking: Booking): void {
    const expanded = new Set(this.expandedBookingIds());
    if (expanded.has(booking.uuid)) {
      expanded.delete(booking.uuid);
    } else {
      expanded.add(booking.uuid);
    }
    this.expandedBookingIds.set(expanded);
  }

  toggleAllExpanded(): void {
    if (this.allExpanded()) {
      this.expandedBookingIds.set(new Set());
    } else {
      this.expandedBookingIds.set(new Set(this.multiProductBookingIds()));
    }
  }

  onStatusChange(booking: Booking, event: Event): void {
    const select = event.target as HTMLSelectElement;
    const newStatus = parseInt(select.value, 10);
    if (isNaN(newStatus)) return;

    this.bookingService.updateBookingStatus(booking.uuid, newStatus).subscribe({
      next: (updated) => {
        const idx = this.bookings().indexOf(booking);
        if (idx !== -1) {
          const list = [...this.bookings()];
          list[idx] = updated;
          this.bookings.set(list);
        }
      },
      error: (err) => {
        console.error('Failed to update booking status:', err);
        // Revert select visually by re-reading
        this.loadBookings();
      },
    });
  }

  onOfferStatusChange(event: Event): void {
    if (!this.offer) return;
    const select = event.target as HTMLSelectElement;
    const newStatus = parseInt(select.value, 10);
    if (isNaN(newStatus)) return;

    this.bookingService
      .updateOfferStatus(this.offer.uuid, newStatus)
      .subscribe({
        next: (updated) => {
          this.offer = updated;
        },
        error: (err) => {
          console.error('Failed to update offer status:', err);
          this.loadOffer(); // revert
        },
      });
  }

  formatStatus(status: OfferStatus): string {
    const labels = ['Brouillon', 'Ouvert', 'Fermé', 'Terminé'];
    return labels[status] ?? String(status);
  }

  toNumber(value: string | number): number {
    return Number(value);
  }

  getStatusLabel(status: number): string {
    const labels = ['En attente', 'Confirmé', 'Annulé', 'Exécuté'];
    return labels[status] || 'Inconnu';
  }

  getStatusClass(status: number): string {
    const classes = ['pending', 'confirmed', 'cancelled', 'fulfilled'];
    return `status-${classes[status]}`;
  }
}
