import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';

type Role = 'CUSTOMER' | 'ADMIN' | 'SME';
type AuthMode = 'login' | 'signup';

interface UserView {
  id: number;
  name: string;
  email: string;
  role: Role;
  customerId: number | null;
}

interface Customer {
  id: number;
  name: string;
  email: string;
  consumerNumbers: string[];
  connectionStatus: string;
  address: string;
  mobile: string;
  customerType: string;
  electricalSection: string;
}

interface Bill {
  id: number;
  customerId: number;
  consumerNumber: string;
  month: string;
  units: number;
  amount: number;
  dueDate: string;
  status: string;
}

interface Complaint {
  id: number;
  customerId: number;
  billId: number | null;
  title: string;
  department: string;
  description: string;
  status: string;
  remarks: string;
  createdOn: string;
}

interface Payment {
  id: number;
  customerId: number;
  billId: number;
  amount: number;
  cardLast4: string;
  paidAt: string;
}

interface BillSummary {
  totalBills: number;
  outstandingAmount: number;
  paidAmount: number;
}

interface Toast {
  id: number;
  text: string;
  tone: 'success' | 'error' | 'info';
}

interface Confirmation {
  title: string;
  message: string;
  actionLabel: string;
  tone?: 'default' | 'danger';
  onConfirm: () => void;
}

interface PaymentGateway {
  bills: Bill[];
  customerId: number;
  allowCash: boolean;
  method: 'card' | 'cash';
  cardName: string;
  cardNumber: string;
  expiry: string;
  cvv: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DatePipe],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  private readonly api = 'http://localhost:8080/api';
  private readonly sessionKey = 'ebilling.session';

  user = signal<UserView | null>(null);
  selectedRole = signal<Role>('CUSTOMER');
  authMode = signal<AuthMode>('login');
  activeTab = signal('dashboard');
  loading = signal(false);
  toasts = signal<Toast[]>([]);
  confirmation = signal<Confirmation | null>(null);
  selectedComplaint = signal<Complaint | null>(null);
  paymentGateway = signal<PaymentGateway | null>(null);
  complaintSource = signal<'ADMIN' | 'SME'>('ADMIN');
  showPassword = signal(false);
  private toastId = 0;

  loginForm = { email: 'customer@demo.com', password: 'customer123', role: 'CUSTOMER' as Role };
  registerForm = { name: '', email: '', password: '', address: '', mobile: '', customerType: 'Residential', electricalSection: 'Office' };
  billFilter = '';
  complaintFilter = '';
  adminSearch = '';
  adminSectionFilter = '';
  adminTypeFilter = '';
  customerPage = 1;
  customerPageSize = 5;
  adminComplaintStatus = '';
  adminComplaintDepartment = '';
  smeStatus = '';
  smeConsumerNumber = '';
  selectedBillIds: number[] = [];
  adminBillCustomerId = 1;
  adminBillStatus = '';

  summary: BillSummary = { totalBills: 0, outstandingAmount: 0, paidAmount: 0 };
  bills: Bill[] = [];
  payments: Payment[] = [];
  complaints: Complaint[] = [];
  customers: Customer[] = [];
  adminBills: Bill[] = [];
  adminComplaints: Complaint[] = [];
  smeComplaints: Complaint[] = [];

  complaintForm = { title: '', department: 'Operations', description: '', billId: null as number | null };
  customerForm = { name: '', email: '', password: 'Customer@123', address: '', mobile: '', customerType: 'Residential', electricalSection: 'Office' };
  updateCustomerForm = { id: 0, name: '', email: '', address: '', mobile: '', customerType: 'Residential', electricalSection: 'Office' };
  consumerNumberForm = { customerId: 0 };
  billForm = { customerId: 1, consumerNumber: '', month: 'May 2026', units: 100, amount: 750, dueDate: this.today() };
  bulkBillForm = { customerIds: '', month: 'May 2026', units: 100, amount: 750, dueDate: this.today() };
  statusForm = { complaintId: 0, status: 'IN_PROGRESS', remarks: '' };
  profileForm = { name: '', email: '', address: '', mobile: '', customerType: 'Residential', electricalSection: 'Office' };

  dummyCards = [
    { name: 'Asha Customer', number: '4242424242424242', expiry: '12/30', cvv: '123' },
    { name: 'Ravi Customer', number: '5555555555554444', expiry: '11/29', cvv: '234' },
    { name: 'Meera Shah', number: '4012888888881881', expiry: '10/28', cvv: '345' },
    { name: 'Kabir Rao', number: '4000056655665556', expiry: '09/27', cvv: '456' },
    { name: 'Nisha Patel', number: '6011111111111117', expiry: '08/26', cvv: '567' }
  ];

  roleTabs = computed(() => {
    const role = this.user()?.role;
    if (role === 'ADMIN') {
      return ['dashboard', 'customers', 'bills', 'complaints', 'profile'];
    }
    if (role === 'SME') {
      return ['dashboard', 'complaints', 'profile'];
    }
    return ['dashboard', 'bills', 'payments', 'complaints', 'profile'];
  });

  constructor(private http: HttpClient) {
    this.restoreSession();
  }

  login(): void {
    this.loading.set(true);
    this.http.post<UserView>(`${this.api}/auth/login`, this.loginForm).subscribe({
      next: user => {
        this.user.set(user);
        this.activeTab.set(this.activeTab() || 'dashboard');
        this.syncProfileForm();
        this.saveSession();
        this.showToast(`Logged in as ${user.name}`, 'success');
        this.loadData();
      },
      error: error => this.fail(error),
      complete: () => this.loading.set(false)
    });
  }

  register(): void {
    if (!this.validateRegistration()) {
      return;
    }
    this.loading.set(true);
    this.http.post<UserView>(`${this.api}/auth/register`, this.registerForm).subscribe({
      next: user => {
        this.user.set(user);
        this.activeTab.set('dashboard');
        this.syncProfileForm();
        this.saveSession();
        this.showToast('Registration completed', 'success');
        this.registerForm = { name: '', email: '', password: '', address: '', mobile: '', customerType: 'Residential', electricalSection: 'Office' };
        this.loadData();
      },
      error: error => this.fail(error),
      complete: () => this.loading.set(false)
    });
  }

  logout(): void {
    this.requestConfirmation({
      title: 'Log out?',
      message: 'You will return to the role selection screen.',
      actionLabel: 'Logout',
      tone: 'danger',
      onConfirm: () => this.logoutConfirmed()
    });
  }

  private logoutConfirmed(): void {
    this.user.set(null);
    localStorage.removeItem(this.sessionKey);
    this.selectedRole.set('CUSTOMER');
    this.authMode.set('login');
    this.selectedComplaint.set(null);
    this.showToast('Logged out successfully', 'info');
  }

  useDemo(role: Role): void {
    const demo = {
      CUSTOMER: ['customer@demo.com', 'customer123'],
      ADMIN: ['admin@demo.com', 'admin123'],
      SME: ['sme@demo.com', 'sme123']
    }[role];
    this.loginForm = { email: demo[0], password: demo[1], role };
    this.selectedRole.set(role);
    if (role !== 'CUSTOMER') {
      this.authMode.set('login');
    }
  }

  chooseRole(role: Role): void {
    this.useDemo(role);
  }

  showSignup(): void {
    this.chooseRole('CUSTOMER');
    this.authMode.set('signup');
  }

  showLogin(): void {
    this.authMode.set('login');
  }

  loadData(): void {
    const role = this.user()?.role;
    if (role === 'ADMIN') {
      this.loadCustomers();
      this.loadAdminComplaints();
    } else if (role === 'SME') {
      this.loadSmeComplaints();
    } else {
      this.loadCustomerData();
    }
  }

  setActiveTab(tab: string): void {
    this.activeTab.set(tab);
    this.saveSession();
    if (tab === 'profile') {
      this.syncProfileForm();
    }
    this.loadData();
  }

  loadCustomerData(): void {
    const customerId = this.user()?.customerId;
    if (!customerId) {
      return;
    }
    const billStatus = this.billFilter ? `?status=${this.billFilter}` : '';
    const complaintStatus = this.complaintFilter ? `?status=${this.complaintFilter}` : '';
    this.http.get<BillSummary>(`${this.api}/customers/${customerId}/bills/summary`).subscribe(data => this.summary = data);
    this.http.get<Bill[]>(`${this.api}/customers/${customerId}/bills${billStatus}`).subscribe(data => {
      this.bills = data;
      this.selectedBillIds = this.selectedBillIds.filter(id => data.some(bill => bill.id === id && bill.status === 'UNPAID'));
    });
    this.http.get<Payment[]>(`${this.api}/customers/${customerId}/payments`).subscribe(data => this.payments = data);
    this.http.get<Complaint[]>(`${this.api}/customers/${customerId}/complaints${complaintStatus}`).subscribe(data => this.complaints = data);
  }

  payBill(bill: Bill): void {
    if (!this.user()?.customerId) {
      return;
    }
    if (bill.status !== 'UNPAID') {
      this.showToast('This bill is already paid.', 'error');
      return;
    }
    this.paymentGateway.set({
      bills: [bill],
      customerId: bill.customerId,
      allowCash: false,
      method: 'card',
      cardName: '',
      cardNumber: '',
      expiry: '',
      cvv: ''
    });
  }

  toggleBillSelection(bill: Bill, checked: boolean): void {
    if (bill.status !== 'UNPAID') {
      return;
    }
    this.selectedBillIds = checked
      ? Array.from(new Set([...this.selectedBillIds, bill.id]))
      : this.selectedBillIds.filter(id => id !== bill.id);
  }

  isBillSelected(bill: Bill): boolean {
    return this.selectedBillIds.includes(bill.id);
  }

  selectedBills(): Bill[] {
    return this.bills.filter(bill => this.selectedBillIds.includes(bill.id) && bill.status === 'UNPAID');
  }

  selectedBillTotal(): number {
    return this.selectedBills().reduce((sum, bill) => sum + Number(bill.amount), 0);
  }

  openSelectedBillsPayment(): void {
    const bills = this.selectedBills();
    if (!bills.length) {
      this.showToast('Select at least one unpaid bill first.', 'error');
      return;
    }
    this.paymentGateway.set({
      bills,
      customerId: bills[0].customerId,
      allowCash: false,
      method: 'card',
      cardName: '',
      cardNumber: '',
      expiry: '',
      cvv: ''
    });
  }

  closePaymentGateway(): void {
    this.paymentGateway.set(null);
  }

  fillDummyCard(card = this.dummyCards[0]): void {
    const gateway = this.paymentGateway();
    if (!gateway) {
      return;
    }
    this.paymentGateway.set({
      ...gateway,
      method: 'card',
      cardName: card.name,
      cardNumber: card.number,
      expiry: card.expiry,
      cvv: card.cvv
    });
  }

  updatePaymentGateway(patch: Partial<PaymentGateway>): void {
    const gateway = this.paymentGateway();
    if (!gateway) {
      return;
    }
    const next = { ...gateway, ...patch };
    next.cardName = this.onlyLetters(next.cardName);
    next.cardNumber = this.onlyDigits(next.cardNumber).slice(0, 16);
    next.cvv = this.onlyDigits(next.cvv).slice(0, 3);
    next.expiry = this.formatExpiry(next.expiry);
    if (!next.allowCash && next.method === 'cash') {
      next.method = 'card';
    }
    this.paymentGateway.set(next);
  }

  adminPayBill(bill: Bill): void {
    if (bill.status !== 'UNPAID') {
      this.showToast('This bill is already paid.', 'error');
      return;
    }
    this.paymentGateway.set({
      bills: [bill],
      customerId: bill.customerId,
      allowCash: true,
      method: 'card',
      cardName: '',
      cardNumber: '',
      expiry: '',
      cvv: ''
    });
  }

  completeGatewayPayment(): void {
    const gateway = this.paymentGateway();
    if (!gateway) {
      return;
    }
    const cardLast4 = gateway.method === 'cash' ? 'CASH' : this.validateCardAndGetLast4(gateway);
    if (!cardLast4) {
      return;
    }
    this.payBillsConfirmed(gateway.bills, gateway.customerId, cardLast4);
  }

  private payBillsConfirmed(bills: Bill[], customerId: number, cardLast4: string): void {
    this.loading.set(true);
    forkJoin(bills.map(bill => this.http.post<Payment>(`${this.api}/customers/${customerId}/bills/${bill.id}/pay`, { cardLast4 }))).subscribe({
      next: payments => {
        this.paymentGateway.set(null);
        this.selectedBillIds = [];
        this.showToast(`${payments.length} bill${payments.length > 1 ? 's' : ''} paid and receipt generated.`, 'success');
        this.user()?.role === 'ADMIN' ? this.loadAdminBills() : this.loadCustomerData();
      },
      error: error => this.fail(error, 'Payment could not be completed. Please try again.'),
      complete: () => this.loading.set(false)
    });
  }

  addComplaint(): void {
    const customerId = this.user()?.customerId;
    if (!customerId) {
      return;
    }
    const payload = {
      ...this.complaintForm,
      billId: this.complaintForm.department === 'Billing' ? this.complaintForm.billId : null
    };
    if (payload.department === 'Billing' && !payload.billId) {
      this.showToast('Enter a bill ID for billing complaints.', 'error');
      return;
    }
    this.http.post<Complaint>(`${this.api}/customers/${customerId}/complaints`, payload).subscribe({
      next: () => {
        this.showToast('Complaint registered', 'success');
        this.complaintForm = { title: '', department: 'Operations', description: '', billId: null };
        this.loadCustomerData();
      },
      error: error => this.fail(error, 'Complaint could not be submitted. Please check the details.')
    });
  }

  loadCustomers(): void {
    const params = new URLSearchParams();
    if (this.adminSearch) params.set('search', this.adminSearch);
    if (this.adminSectionFilter) params.set('electricalSection', this.adminSectionFilter);
    if (this.adminTypeFilter) params.set('customerType', this.adminTypeFilter);
    const query = params.toString() ? `?${params}` : '';
    this.http.get<Customer[]>(`${this.api}/admin/customers${query}`).subscribe(data => {
      this.customers = data;
      this.customerPage = Math.min(this.customerPage, this.customerTotalPages());
      if (data.length && !this.billForm.customerId) {
        this.billForm.customerId = data[0].id;
      }
      this.syncBillConsumerNumber();
    });
  }

  pagedCustomers(): Customer[] {
    const start = (this.customerPage - 1) * this.customerPageSize;
    return this.customers.slice(start, start + this.customerPageSize);
  }

  customerTotalPages(): number {
    return Math.max(1, Math.ceil(this.customers.length / this.customerPageSize));
  }

  changeCustomerPage(delta: number): void {
    this.customerPage = Math.min(this.customerTotalPages(), Math.max(1, this.customerPage + delta));
  }

  addCustomer(): void {
    this.customerForm.name = this.onlyLetters(this.customerForm.name);
    this.customerForm.mobile = this.onlyDigits(this.customerForm.mobile).slice(0, 10);
    if (!this.validateCustomerLike(this.customerForm, true)) {
      return;
    }
    this.http.post<Customer>(`${this.api}/admin/customers`, this.customerForm).subscribe({
      next: () => {
        this.showToast('Customer added', 'success');
        this.customerForm = { name: '', email: '', password: 'Customer@123', address: '', mobile: '', customerType: 'Residential', electricalSection: 'Office' };
        this.loadCustomers();
      },
      error: error => this.fail(error, 'Customer could not be added. Please check the details.')
    });
  }

  editCustomer(customer: Customer): void {
    this.updateCustomerForm = {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      address: customer.address,
      mobile: customer.mobile,
      customerType: customer.customerType,
      electricalSection: customer.electricalSection
    };
    this.consumerNumberForm.customerId = customer.id;
  }

  updateCustomer(): void {
    this.updateCustomerForm.name = this.onlyLetters(this.updateCustomerForm.name);
    this.updateCustomerForm.mobile = this.onlyDigits(this.updateCustomerForm.mobile).slice(0, 10);
    if (!this.validateCustomerLike(this.updateCustomerForm, false)) {
      return;
    }
    this.http.put<Customer>(`${this.api}/admin/customers/${this.updateCustomerForm.id}`, this.updateCustomerForm).subscribe({
      next: () => {
        this.showToast('Customer updated', 'success');
        this.loadCustomers();
      },
      error: error => this.fail(error, 'Customer details could not be updated.')
    });
  }

  addConsumerNumber(): void {
    const { customerId } = this.consumerNumberForm;
    this.http.post<Customer>(`${this.api}/admin/customers/${customerId}/consumer-numbers`, {}).subscribe({
      next: () => {
        this.showToast('Consumer number generated', 'success');
        this.loadCustomers();
      },
      error: error => this.fail(error, 'Consumer number could not be added.')
    });
  }

  updateConnection(customer: Customer, connectionStatus: string): void {
    this.requestConfirmation({
      title: `${connectionStatus === 'ACTIVE' ? 'Reconnect' : 'Disconnect'} customer?`,
      message: `${customer.name}'s connection status will be changed to ${connectionStatus}.`,
      actionLabel: connectionStatus === 'ACTIVE' ? 'Reconnect' : 'Disconnect',
      tone: connectionStatus === 'ACTIVE' ? 'default' : 'danger',
      onConfirm: () => this.updateConnectionConfirmed(customer, connectionStatus)
    });
  }

  private updateConnectionConfirmed(customer: Customer, connectionStatus: string): void {
    this.http.put<Customer>(`${this.api}/admin/customers/${customer.id}/connection`, { connectionStatus }).subscribe({
      next: () => {
        this.showToast(`Connection ${connectionStatus.toLowerCase()}`, 'success');
        this.loadCustomers();
      },
      error: error => this.failOrUnpaidModal(error, 'Connection status could not be changed.')
    });
  }

  deleteCustomer(customer: Customer): void {
    this.requestConfirmation({
      title: 'Delete customer?',
      message: `Customer #${customer.id} (${customer.name}) and linked consumers, bills, payments, and complaints will be removed.`,
      actionLabel: 'Delete',
      tone: 'danger',
      onConfirm: () => this.deleteCustomerConfirmed(customer)
    });
  }

  private deleteCustomerConfirmed(customer: Customer): void {
    this.http.delete<void>(`${this.api}/admin/customers/${customer.id}`).subscribe({
      next: () => {
        this.showToast(`Customer #${customer.id} deleted`, 'success');
        if (this.updateCustomerForm.id === customer.id) {
          this.updateCustomerForm = { id: 0, name: '', email: '', address: '', mobile: '', customerType: 'Residential', electricalSection: 'Office' };
        }
        this.loadCustomers();
      },
      error: error => this.failOrUnpaidModal(error, 'Customer could not be deleted.')
    });
  }

  addBill(): void {
    this.syncBillConsumerNumber();
    if (!this.validateBillForm(this.billForm)) {
      return;
    }
    this.http.post<Bill>(`${this.api}/admin/bills`, this.billForm).subscribe({
      next: () => {
        this.showToast('Bill added', 'success');
        this.loadCustomers();
      },
      error: error => this.fail(error, 'Bill could not be added. Please check the customer and bill details.')
    });
  }

  loadAdminBills(): void {
    if (!this.adminBillCustomerId) {
      this.showToast('Enter a customer ID to view bill history.', 'error');
      return;
    }
    const status = this.adminBillStatus ? `?status=${this.adminBillStatus}` : '';
    this.http.get<Bill[]>(`${this.api}/customers/${this.adminBillCustomerId}/bills${status}`).subscribe({
      next: bills => {
        this.adminBills = bills;
        if (!bills.length) {
          this.showToast('No bills found for this customer and filter.', 'info');
        }
      },
      error: error => this.fail(error, 'Bill history could not be loaded.')
    });
  }

  exportAdminBills(): void {
    if (!this.adminBills.length) {
      this.showToast('Load bill history before exporting.', 'error');
      return;
    }
    const rows = [
      ['Bill ID', 'Customer ID', 'Consumer Number', 'Billing Period', 'Units', 'Amount', 'Bill Date', 'Status'],
      ...this.adminBills.map(bill => [bill.id, bill.customerId, bill.consumerNumber, bill.month, bill.units, bill.amount, bill.dueDate, bill.status])
    ];
    this.download(`customer-${this.adminBillCustomerId}-bills.csv`, rows.map(row => row.join(',')).join('\n'));
    this.showToast('Bill history exported', 'success');
  }

  bulkUploadBills(): void {
    if (!this.validateBillForm({ ...this.bulkBillForm, customerId: 1, consumerNumber: 'bulk' })) {
      return;
    }
    const payload = {
      ...this.bulkBillForm,
      customerIds: this.bulkBillForm.customerIds.split(',').map(id => Number(id.trim())).filter(Boolean)
    };
    this.http.post<Bill[]>(`${this.api}/admin/bills/bulk`, payload).subscribe({
      next: bills => this.showToast(`${bills.length} bills uploaded`, 'success'),
      error: error => this.fail(error, 'Bulk bill upload failed. Please verify the customer IDs.')
    });
  }

  loadAdminComplaints(): void {
    const params = new URLSearchParams();
    if (this.adminComplaintStatus) params.set('status', this.adminComplaintStatus);
    if (this.adminComplaintDepartment) params.set('department', this.adminComplaintDepartment);
    const query = params.toString() ? `?${params}` : '';
    this.http.get<Complaint[]>(`${this.api}/admin/complaints${query}`).subscribe(data => this.adminComplaints = data);
  }

  loadSmeComplaints(): void {
    const params = new URLSearchParams();
    if (this.smeStatus) params.set('status', this.smeStatus);
    if (this.smeConsumerNumber) params.set('consumerNumber', this.smeConsumerNumber);
    const query = params.toString() ? `?${params}` : '';
    this.http.get<Complaint[]>(`${this.api}/sme/complaints${query}`).subscribe(data => this.smeComplaints = data);
  }

  prepareStatus(complaint: Complaint, source: 'ADMIN' | 'SME'): void {
    if (complaint.status === 'RESOLVED') {
      this.showToast('Closed complaints are locked and cannot be changed.', 'error');
      return;
    }
    this.statusForm = { complaintId: complaint.id, status: complaint.status, remarks: complaint.remarks || '' };
    this.complaintSource.set(source);
    this.selectedComplaint.set(complaint);
  }

  closeStatusEditor(): void {
    this.selectedComplaint.set(null);
  }

  updateComplaint(): void {
    const source = this.complaintSource();
    this.requestConfirmation({
      title: 'Update complaint?',
      message: `Complaint #${this.statusForm.complaintId} will move to ${this.statusForm.status}.`,
      actionLabel: 'Update',
      onConfirm: () => this.updateComplaintConfirmed(source)
    });
  }

  private updateComplaintConfirmed(source: 'ADMIN' | 'SME'): void {
    const url = source === 'ADMIN'
      ? `${this.api}/admin/complaints/${this.statusForm.complaintId}`
      : `${this.api}/sme/complaints/${this.statusForm.complaintId}/act`;
    this.http.put<Complaint>(url, this.statusForm).subscribe({
      next: () => {
        this.showToast('Complaint status updated', 'success');
        this.selectedComplaint.set(null);
        source === 'ADMIN' ? this.loadAdminComplaints() : this.loadSmeComplaints();
      },
      error: error => this.fail(error, 'Complaint status could not be updated.')
    });
  }

  downloadBill(bill: Bill): void {
    this.download(`bill-${bill.id}.html`, this.billInvoiceHtml(bill), 'text/html');
    this.showToast('Styled bill downloaded', 'info');
  }

  downloadPayment(payment: Payment): void {
    this.download(`payment-${payment.id}.html`, this.paymentReceiptHtml(payment), 'text/html');
    this.showToast('Styled payment receipt downloaded', 'info');
  }

  paymentMode(payment: Payment): string {
    return payment.cardLast4 === 'CASH' ? 'Pay on Cash' : `Card ending ${payment.cardLast4}`;
  }

  transactionId(payment: Payment): string {
    return `TXN-${String(payment.id).padStart(6, '0')}`;
  }

  receiptNumber(payment: Payment): string {
    return `RCPT-${String(payment.customerId).padStart(3, '0')}-${String(payment.id).padStart(5, '0')}`;
  }

  confirmAction(): void {
    const current = this.confirmation();
    if (!current) {
      return;
    }
    this.confirmation.set(null);
    current.onConfirm();
  }

  cancelConfirmation(): void {
    this.confirmation.set(null);
  }

  removeToast(id: number): void {
    this.toasts.update(items => items.filter(toast => toast.id !== id));
  }

  private download(fileName: string, content: string, type = 'text/plain'): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  private billInvoiceHtml(bill: Bill): string {
    const amount = this.money(bill.amount);
    return this.documentTemplate('Electricity Bill', `
      <section class="hero">
        <div>
          <p class="eyebrow">Electricity Board</p>
          <h1>Electricity Bill</h1>
          <span class="muted">Invoice #EB-${String(bill.id).padStart(6, '0')}</span>
        </div>
        <span class="status ${bill.status === 'PAID' ? 'paid' : 'unpaid'}">${this.escapeHtml(bill.status)}</span>
      </section>

      <section class="summary">
        <div>
          <span>Total Amount</span>
          <strong>${amount}</strong>
        </div>
        <div>
          <span>Billing Month</span>
          <strong>${this.escapeHtml(bill.month)}</strong>
        </div>
        <div>
          <span>Bill Date</span>
          <strong>${this.formatDate(bill.dueDate)}</strong>
        </div>
      </section>

      <section class="panel">
        <h2>Consumer Details</h2>
        <dl>
          <div><dt>Customer Number</dt><dd>#${bill.customerId}</dd></div>
          <div><dt>Consumer Number</dt><dd>${this.escapeHtml(bill.consumerNumber)}</dd></div>
          <div><dt>Bill Number</dt><dd>#${bill.id}</dd></div>
        </dl>
      </section>

      <section class="panel">
        <h2>Bill Breakdown</h2>
        <table>
          <thead><tr><th>Description</th><th>Units</th><th>Amount</th></tr></thead>
          <tbody>
            <tr><td>Electricity consumption charges</td><td>${bill.units}</td><td>${amount}</td></tr>
          </tbody>
          <tfoot><tr><td colspan="2">Grand Total</td><td>${amount}</td></tr></tfoot>
        </table>
      </section>
    `);
  }

  private paymentReceiptHtml(payment: Payment): string {
    const amount = this.money(payment.amount);
    return this.documentTemplate('Payment Receipt', `
      <section class="hero">
        <div>
          <p class="eyebrow">Electricity Board</p>
          <h1>Payment Receipt</h1>
          <span class="muted">Invoice ${this.escapeHtml(`INV-${payment.id}`)}</span>
        </div>
        <span class="status paid">SUCCESS</span>
      </section>

      <section class="summary">
        <div>
          <span>Amount Paid</span>
          <strong>${amount}</strong>
        </div>
        <div>
          <span>Transaction ID</span>
          <strong>${this.escapeHtml(this.transactionId(payment))}</strong>
        </div>
        <div>
          <span>Paid At</span>
          <strong>${this.formatDateTime(payment.paidAt)}</strong>
        </div>
      </section>

      <section class="panel">
        <h2>Receipt Details</h2>
        <dl>
          <div><dt>Receipt Number</dt><dd>${this.escapeHtml(this.receiptNumber(payment))}</dd></div>
          <div><dt>Payment ID</dt><dd>#${payment.id}</dd></div>
          <div><dt>Customer Number</dt><dd>#${payment.customerId}</dd></div>
          <div><dt>Bill Number</dt><dd>#${payment.billId}</dd></div>
          <div><dt>Payment Mode</dt><dd>${this.escapeHtml(this.paymentMode(payment))}</dd></div>
          <div><dt>Status</dt><dd>SUCCESS</dd></div>
        </dl>
      </section>

      <section class="panel">
        <h2>Transaction Summary</h2>
        <table>
          <thead><tr><th>Description</th><th>Reference</th><th>Amount</th></tr></thead>
          <tbody>
            <tr><td>Electricity bill payment</td><td>Bill #${payment.billId}</td><td>${amount}</td></tr>
          </tbody>
          <tfoot><tr><td colspan="2">Total Paid</td><td>${amount}</td></tr></tfoot>
        </table>
      </section>
    `);
  }

  private documentTemplate(title: string, body: string): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${this.escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #eef4fb; color: #172033; font-family: Arial, Helvetica, sans-serif; }
    .page { background: #fff; margin: 32px auto; max-width: 860px; min-height: 100vh; padding: 42px; box-shadow: 0 24px 70px rgba(15, 23, 42, .16); }
    .hero { align-items: flex-start; border-bottom: 3px solid #1d4ed8; display: flex; justify-content: space-between; gap: 24px; padding-bottom: 24px; }
    .eyebrow { color: #0f766e; font-size: 12px; font-weight: 800; letter-spacing: .12em; margin: 0 0 8px; text-transform: uppercase; }
    h1 { font-size: 34px; line-height: 1; margin: 0 0 8px; }
    h2 { font-size: 17px; margin: 0 0 14px; }
    .muted { color: #64748b; font-size: 13px; font-weight: 700; }
    .status { border-radius: 999px; color: #fff; display: inline-block; font-size: 12px; font-weight: 800; padding: 9px 13px; text-transform: uppercase; }
    .status.paid { background: #047857; }
    .status.unpaid { background: #be123c; }
    .summary { display: grid; gap: 12px; grid-template-columns: repeat(3, 1fr); margin: 24px 0; }
    .summary div { background: #f8fafc; border: 1px solid #dbe4ef; border-radius: 8px; padding: 16px; }
    .summary span, dt { color: #64748b; display: block; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .summary strong { color: #172033; display: block; font-size: 20px; margin-top: 8px; }
    .panel { border: 1px solid #dbe4ef; border-radius: 8px; margin-top: 18px; padding: 20px; }
    dl { display: grid; gap: 12px; grid-template-columns: repeat(3, 1fr); margin: 0; }
    dd { font-size: 15px; font-weight: 800; margin: 6px 0 0; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 13px 10px; text-align: left; }
    th { color: #64748b; font-size: 12px; text-transform: uppercase; }
    td:last-child, th:last-child { text-align: right; }
    tfoot td { border-bottom: 0; color: #172033; font-size: 16px; font-weight: 800; }
    .footer { color: #64748b; font-size: 12px; line-height: 1.5; margin-top: 24px; text-align: center; }
    .print { background: #1d4ed8; border: 0; border-radius: 7px; color: #fff; cursor: pointer; font-weight: 800; margin-top: 24px; padding: 12px 18px; }
    @media print { body { background: #fff; } .page { box-shadow: none; margin: 0; max-width: none; } .print { display: none; } }
    @media (max-width: 720px) { .page { margin: 0; padding: 24px; } .hero, .summary, dl { grid-template-columns: 1fr; } .hero { display: grid; } }
  </style>
</head>
<body>
  <main class="page">
    ${body}
    <p class="footer">This is a system generated document from the Electricity Board Billing & Complaint Portal.</p>
    <button class="print" onclick="window.print()">Print / Save as PDF</button>
  </main>
</body>
</html>`;
  }

  private money(value: number): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(value));
  }

  private formatDate(value: string): string {
    return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  private formatDateTime(value: string): string {
    return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }

  private escapeHtml(value: string): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private todayPlus(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  minBillDate(): string {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date.toISOString().slice(0, 10);
  }

  onNameInput(target: { name: string }): void {
    target.name = this.onlyLetters(target.name);
  }

  onMobileInput(target: { mobile: string }): void {
    target.mobile = this.onlyDigits(target.mobile).slice(0, 10);
  }

  allowCardHolderInput(event: Event): void {
    this.preventInvalidTextInput(event, /^[A-Za-z ]+$/);
  }

  allowDigitsInput(event: Event): void {
    this.preventInvalidTextInput(event, /^\d+$/);
  }

  syncBillConsumerNumber(): void {
    const customer = this.customers.find(item => item.id === Number(this.billForm.customerId));
    if (!customer) {
      return;
    }
    if (!customer.consumerNumbers.includes(this.billForm.consumerNumber)) {
      this.billForm.consumerNumber = customer.consumerNumbers[0] || '';
    }
  }

  saveProfile(): void {
    const current = this.user();
    if (!current) {
      return;
    }
    this.profileForm.name = this.onlyLetters(this.profileForm.name);
    this.profileForm.mobile = this.onlyDigits(this.profileForm.mobile).slice(0, 10);
    if (current.role === 'CUSTOMER' && !this.validateCustomerLike(this.profileForm, false)) {
      return;
    }
    if (current.role !== 'CUSTOMER' && (!this.validName(this.profileForm.name) || !this.validEmail(this.profileForm.email))) {
      this.showToast('Enter a valid name and email.', 'error');
      return;
    }
    this.http.put<UserView>(`${this.api}/users/${current.id}/profile`, this.profileForm).subscribe({
      next: user => {
        this.user.set(user);
        this.saveSession();
        this.showToast('Profile updated', 'success');
        this.loadData();
      },
      error: error => this.fail(error, 'Profile could not be updated.')
    });
  }

  private syncProfileForm(): void {
    const current = this.user();
    if (!current) {
      return;
    }
    this.profileForm = {
      name: current.name,
      email: current.email,
      address: this.profileForm.address,
      mobile: this.profileForm.mobile,
      customerType: this.profileForm.customerType,
      electricalSection: this.profileForm.electricalSection
    };
    if (current.customerId) {
      this.http.get<Customer[]>(`${this.api}/admin/customers?search=${current.customerId}`).subscribe(customers => {
        const customer = customers.find(item => item.id === current.customerId);
        if (customer) {
          this.profileForm = {
            name: customer.name,
            email: customer.email,
            address: customer.address,
            mobile: customer.mobile,
            customerType: customer.customerType,
            electricalSection: customer.electricalSection
          };
        }
      });
    }
  }

  private restoreSession(): void {
    const raw = localStorage.getItem(this.sessionKey);
    if (!raw) {
      return;
    }
    try {
      const session = JSON.parse(raw) as { user?: UserView, activeTab?: string };
      if (session.user) {
        this.user.set(session.user);
        this.selectedRole.set(session.user.role);
        this.activeTab.set(session.activeTab || 'dashboard');
        this.syncProfileForm();
        this.loadData();
      }
    } catch {
      localStorage.removeItem(this.sessionKey);
    }
  }

  private saveSession(): void {
    const current = this.user();
    if (current) {
      localStorage.setItem(this.sessionKey, JSON.stringify({ user: current, activeTab: this.activeTab() }));
    }
  }

  private validateRegistration(): boolean {
    const form = this.registerForm;
    form.name = this.onlyLetters(form.name);
    form.mobile = this.onlyDigits(form.mobile).slice(0, 10);
    if (!this.validateCustomerLike(form, false)) {
      return false;
    }
    if (!this.validEmail(form.email)) {
      this.showToast('Enter a valid email address.', 'error');
      return false;
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(form.password)) {
      this.showToast('Password needs 8 characters with uppercase, lowercase, number, and special character.', 'error');
      return false;
    }
    return true;
  }

  private validateCustomerLike(form: { name: string; email: string; address: string; mobile: string; password?: string }, requirePassword: boolean): boolean {
    if (!/^[A-Za-z ]{2,50}$/.test(form.name.trim())) {
      this.showToast('Name should contain only characters and be under 50 characters.', 'error');
      return false;
    }
    if (!this.validEmail(form.email)) {
      this.showToast('Enter a valid email address.', 'error');
      return false;
    }
    if (form.address.trim().length < 8) {
      this.showToast('Address should be at least 8 characters long.', 'error');
      return false;
    }
    if (!/^\d{10}$/.test(form.mobile.trim())) {
      this.showToast('Mobile number must contain 10 digits.', 'error');
      return false;
    }
    if (requirePassword && form.password && !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(form.password)) {
      this.showToast('Password needs 8 characters with uppercase, lowercase, number, and special character.', 'error');
      return false;
    }
    return true;
  }

  private validateBillForm(form: { customerId: number; consumerNumber: string; month: string; units: number; amount: number; dueDate: string }): boolean {
    if (!form.customerId || (!form.consumerNumber && form.consumerNumber !== 'bulk')) {
      this.showToast('Select both customer and consumer number.', 'error');
      return false;
    }
    if (!/^[A-Za-z]+ \d{4}$/.test(form.month.trim())) {
      this.showToast('Billing month must be like May 2026.', 'error');
      return false;
    }
    if (Number(form.units) <= 0) {
      this.showToast('Units must be greater than zero.', 'error');
      return false;
    }
    if (Number(form.amount) <= 0 || Number(form.amount) > 5000) {
      this.showToast('Bill amount must be between 1 and 5000.', 'error');
      return false;
    }
    if (form.dueDate < this.minBillDate() || form.dueDate > this.today()) {
      this.showToast('Bill date must be within the last one month and cannot be future dated.', 'error');
      return false;
    }
    return true;
  }

  private validName(value: string): boolean {
    return /^[A-Za-z ]{2,50}$/.test(value.trim());
  }

  private validEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
  }

  private onlyLetters(value: string): string {
    return value.replace(/[^A-Za-z ]/g, '').replace(/\s{2,}/g, ' ');
  }

  private onlyDigits(value: string): string {
    return value.replace(/\D/g, '');
  }

  private preventInvalidTextInput(event: Event, allowed: RegExp): void {
    const input = event as InputEvent;
    if (!input.data || input.inputType.startsWith('delete')) {
      return;
    }
    if (!allowed.test(input.data)) {
      event.preventDefault();
    }
  }

  private formatExpiry(value: string): string {
    const digits = this.onlyDigits(value).slice(0, 4);
    if (digits.length <= 2) {
      return digits;
    }
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }

  private validateCardAndGetLast4(gateway: PaymentGateway): string {
    const digits = gateway.cardNumber.replace(/\D/g, '');
    if (!this.validName(gateway.cardName)) {
      this.showToast('Card holder name should contain only letters.', 'error');
      return '';
    }
    if (digits.length !== 16) {
      this.showToast('Enter a valid 16 digit card number, or use the demo card.', 'error');
      return '';
    }
    if (!/^\d{2}\/\d{2}$/.test(gateway.expiry.trim())) {
      this.showToast('Enter expiry in MM/YY format.', 'error');
      return '';
    }
    const [month, year] = gateway.expiry.split('/').map(Number);
    const expiryDate = new Date(2000 + year, month, 0);
    if (month < 1 || month > 12 || expiryDate < new Date()) {
      this.showToast('Enter a valid future card expiry.', 'error');
      return '';
    }
    if (!/^\d{3}$/.test(gateway.cvv.trim())) {
      this.showToast('Enter a valid 3 digit CVV.', 'error');
      return '';
    }
    return digits.slice(-4);
  }

  private fail(error: { status?: number, error?: { message?: string }, message?: string }, fallback = 'We could not complete that action. Please try again.'): void {
    this.showToast(this.friendlyError(error, fallback), 'error');
    this.loading.set(false);
  }

  private failOrUnpaidModal(error: { status?: number, error?: { message?: string }, message?: string }, fallback: string): void {
    const message = (error.error?.message || '').toLowerCase();
    if (message.includes('unpaid bills')) {
      this.requestConfirmation({
        title: 'Unpaid bills found',
        message: 'This customer or consumer cannot be deleted or disconnected until all unpaid bills are paid.',
        actionLabel: 'OK',
        tone: 'default',
        onConfirm: () => {}
      });
      return;
    }
    this.fail(error, fallback);
  }

  private friendlyError(error: { status?: number, error?: { message?: string }, message?: string }, fallback: string): string {
    const serverMessage = (error.error?.message || '').toLowerCase();
    if (error.status === 0) {
      return 'Server is not reachable. Please start the backend and try again.';
    }
    if (serverMessage.includes('invalid login')) {
      return 'Email, password, or selected role is incorrect.';
    }
    if (serverMessage.includes('email')) {
      return 'This email is already used or is not valid.';
    }
    if (serverMessage.includes('consumer number')) {
      return 'This consumer number is already linked or is not valid.';
    }
    if (serverMessage.includes('customer not found')) {
      return 'No customer record was found for that ID.';
    }
    if (serverMessage.includes('bill not found')) {
      return 'No bill was found for this payment.';
    }
    if (serverMessage.includes('already paid')) {
      return 'This bill has already been paid.';
    }
    if (serverMessage.includes('unpaid bills')) {
      return 'Unpaid bills must be paid before deleting or disconnecting.';
    }
    if (serverMessage.includes('maximum of 5')) {
      return 'Each customer can have a maximum of 5 consumers.';
    }
    if (serverMessage.includes('already has a bill')) {
      return 'This consumer already has a bill for that month.';
    }
    if (serverMessage.includes('closed complaints')) {
      return 'Closed complaints are locked and cannot be changed.';
    }
    if (serverMessage.includes('5000')) {
      return 'Bill amount must be between 1 and 5000.';
    }
    if (error.status === 400) {
      return fallback;
    }
    if (error.status === 404) {
      return 'The requested record could not be found.';
    }
    return fallback;
  }

  private requestConfirmation(confirmation: Confirmation): void {
    this.confirmation.set(confirmation);
  }

  private showToast(text: string, tone: Toast['tone'] = 'info'): void {
    const id = ++this.toastId;
    this.toasts.update(items => [...items, { id, text, tone }]);
    window.setTimeout(() => this.removeToast(id), 3200);
  }
}
