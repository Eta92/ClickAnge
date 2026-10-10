import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { DateTime } from 'luxon';
import { LoginService } from '../../core/auth/login.service';
import { BulkAddResult, Member, Role } from '../../core/models/customer.model';
import {
  ROLES,
  roleBadgeClass,
  roleLabel,
  rolesAbove,
} from '../../core/models/role.helper';
import { MemberService } from '../../core/services/member.service';

type RoleFilter = Role | 'ALL';

type SortKey =
  | 'name'
  | 'email'
  | 'isSubscribed'
  | 'role'
  | 'emailVerified'
  | 'createdAt'
  | 'lastConnectedAt'
  | 'lastBookingAt';

interface SortState {
  key: SortKey;
  direction: 'asc' | 'desc';
}

@Component({
  standalone: false,
  selector: 'app-members',
  templateUrl: './members.component.html',
  styleUrls: ['./members.component.scss'],
})
export class MembersComponent implements OnInit {
  private readonly memberService = inject(MemberService);
  private readonly loginService = inject(LoginService);
  private readonly router = inject(Router);
  private readonly toastr = inject(ToastrService);

  // template helpers
  readonly Role = Role;
  readonly allRoles = ROLES;
  readonly roleLabel = roleLabel;
  readonly roleBadgeClass = roleBadgeClass;

  readonly isLoading = this.memberService.isLoading;
  readonly pendingCount = this.memberService.pendingCount;

  // --- filters ---
  readonly search = signal('');
  readonly roleFilter = signal<RoleFilter>('ALL');

  readonly filteredMembers = computed(() => {
    const needle = this.search().trim().toLowerCase();
    const role = this.roleFilter();
    return this.memberService.members().filter((member) => {
      if (role !== 'ALL' && member.role !== role) return false;
      if (!needle) return true;
      return (
        member.email.includes(needle) ||
        (member.name ?? '').toLowerCase().includes(needle)
      );
    });
  });

  // --- sorting ---
  readonly columns: ReadonlyArray<{ key: SortKey; label: string; class?: string }> = [
    { key: 'name', label: 'Nom' },
    { key: 'email', label: 'Email' },
    { key: 'isSubscribed', label: 'Abonné', class: 'member-subscribed' },
    { key: 'role', label: 'Rôle' },
    { key: 'emailVerified', label: 'Inscription' },
    { key: 'createdAt', label: 'Ajouté le', class: 'member-date-col' },
    { key: 'lastConnectedAt', label: 'Dernière connexion', class: 'member-date-col' },
    { key: 'lastBookingAt', label: 'Dernière réservation', class: 'member-date-col' },
  ];

  /** Null when the table keeps the server's order. */
  readonly sort = signal<SortState | null>(null);

  readonly sortedMembers = computed(() => {
    const members = this.filteredMembers();
    const sort = this.sort();
    if (!sort) return members;
    const sign = sort.direction === 'asc' ? 1 : -1;
    return [...members].sort((a, b) => {
      const left = this.sortValue(a, sort.key);
      const right = this.sortValue(b, sort.key);
      // Empty values stay at the bottom whichever way the column is sorted.
      if (left === undefined || right === undefined) {
        return left === right ? 0 : left === undefined ? 1 : -1;
      }
      const diff =
        typeof left === 'string' && typeof right === 'string'
          ? left.localeCompare(right, 'fr')
          : (left as number) - (right as number);
      return diff * sign;
    });
  });

  /** Row count per role, for the filter chips. */
  readonly countsByRole = computed(() => {
    const counts: Record<string, number> = { ALL: 0 };
    for (const role of ROLES) counts[role] = 0;
    for (const member of this.memberService.members()) {
      counts['ALL']++;
      counts[member.role] = (counts[member.role] ?? 0) + 1;
    }
    return counts;
  });

  // --- add a single member ---
  newName = '';
  newEmail = '';
  readonly isSubmitting = signal(false);

  // --- bulk add ---
  readonly showBulk = signal(false);
  bulkRaw = '';
  readonly bulkResult = signal<BulkAddResult | null>(null);

  ngOnInit(): void {
    // The page is manager-only; the server enforces it too, this just avoids
    // showing an empty screen to anyone who guessed the URL.
    if (!this.loginService.isManager()) {
      this.router.navigate(['/home']);
      return;
    }
    this.loadMembers();
  }

  loadMembers(): void {
    this.memberService.loadMembers().subscribe({
      error: (err: Error) =>
        this.toastr.error(err.message, 'Chargement impossible'),
    });
  }

  // --- filters ---

  onSearchChange(value: string): void {
    this.search.set(value);
  }

  setRoleFilter(role: RoleFilter): void {
    this.roleFilter.set(role);
  }

  // --- sorting ---

  /** Ascending, then descending, then back to the default order. */
  toggleSort(key: SortKey): void {
    const current = this.sort();
    if (current?.key !== key) {
      this.sort.set({ key, direction: 'asc' });
    } else if (current.direction === 'asc') {
      this.sort.set({ key, direction: 'desc' });
    } else {
      this.sort.set(null);
    }
  }

  ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    const current = this.sort();
    if (current?.key !== key) return 'none';
    return current.direction === 'asc' ? 'ascending' : 'descending';
  }

  private sortValue(member: Member, key: SortKey): string | number | undefined {
    switch (key) {
      case 'name':
        return member.name || undefined;
      case 'email':
        return member.email;
      case 'isSubscribed':
        return member.isSubscribed ? 1 : 0;
      case 'role':
        return ROLES.indexOf(member.role);
      case 'emailVerified':
        return member.emailVerified ? 1 : 0;
      default:
        return member[key];
    }
  }

  // --- add a single member ---

  addMember(): void {
    const email = this.newEmail.trim();
    if (!email || this.isSubmitting()) return;

    this.isSubmitting.set(true);
    this.memberService.addMember(email, this.newName.trim() || undefined).subscribe({
      next: (member) => {
        this.memberService.applyMember(member);
        this.isSubmitting.set(false);
        this.newName = '';
        this.newEmail = '';
        this.toastr.success(`${member.email} peut maintenant se connecter.`, 'Membre ajouté');
      },
      error: (err: Error) => {
        this.isSubmitting.set(false);
        this.toastr.error(err.message, 'Ajout impossible');
      },
    });
  }

  // --- bulk add ---

  toggleBulk(): void {
    this.showBulk.update((open) => !open);
    this.bulkResult.set(null);
  }

  addBulk(): void {
    const raw = this.bulkRaw.trim();
    if (!raw || this.isSubmitting()) return;

    this.isSubmitting.set(true);
    this.memberService.addMembers(raw).subscribe({
      next: (result) => {
        for (const member of result.added) this.memberService.applyMember(member);
        this.isSubmitting.set(false);
        this.bulkResult.set(result);
        this.bulkRaw = '';
        this.toastr.success(
          `${result.added.length} membre(s) ajouté(s).`,
          'Import terminé',
        );
      },
      error: (err: Error) => {
        this.isSubmitting.set(false);
        this.toastr.error(err.message, 'Import impossible');
      },
    });
  }

  // --- promotion ---

  /**
   * Roles offered in a row's dropdown: the current one plus everything above.
   * Precomputed per role so the template hands `@for` a stable array.
   */
  private readonly optionsByRole: Record<Role, Array<Role>> = ROLES.reduce(
    (acc, role) => ({ ...acc, [role]: [role, ...rolesAbove(role)] }),
    {} as Record<Role, Array<Role>>,
  );

  promotionOptions(member: Member): Array<Role> {
    return this.optionsByRole[member.role];
  }

  /** Only a member who is not already at the top can be promoted. */
  canPromote(member: Member): boolean {
    return this.optionsByRole[member.role].length > 1;
  }

  onRoleChange(member: Member, event: Event): void {
    const select = event.target as HTMLSelectElement;
    const role = select.value as Role;
    if (role === member.role) return;

    this.memberService.promoteMember(member.email, role).subscribe({
      next: (updated) => {
        this.memberService.applyMember(updated);
        this.toastr.success(
          `${updated.email} est maintenant ${roleLabel(updated.role)}.`,
          'Rôle mis à jour',
        );
      },
      error: (err: Error) => {
        // Put the dropdown back on the role the server still holds.
        select.value = member.role;
        this.toastr.error(err.message, 'Promotion impossible');
      },
    });
  }

  // --- deletion ---

  /** Member awaiting confirmation in the delete modal, null when it is closed. */
  readonly memberToDelete = signal<Member | null>(null);
  readonly isDeleting = signal(false);

  askDelete(member: Member): void {
    this.memberToDelete.set(member);
  }

  cancelDelete(): void {
    if (this.isDeleting()) return;
    this.memberToDelete.set(null);
  }

  confirmDelete(): void {
    const member = this.memberToDelete();
    if (!member || this.isDeleting()) return;

    this.isDeleting.set(true);
    this.memberService.deleteMember(member.email).subscribe({
      next: (email) => {
        this.memberService.removeMember(email);
        this.isDeleting.set(false);
        this.memberToDelete.set(null);
        this.toastr.success(`${email} a été supprimé.`, 'Membre supprimé');
      },
      error: (err: Error) => {
        this.isDeleting.set(false);
        this.toastr.error(err.message, 'Suppression impossible');
      },
    });
  }

  // --- display helpers ---

  formatDate(epochMs: number): string {
    return DateTime.fromMillis(epochMs).toFormat('dd/MM/yyyy');
  }

  isSelf(member: Member): boolean {
    return member.email === this.loginService.getStoredProfile()?.email;
  }
}
