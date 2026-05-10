import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

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
  month: string;
  units: number;
  amount: number;
  dueDate: string;
  status: string;
}

interface Complaint {
  id: number;
  customerId: number;
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
  bill: Bill;
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
  private toastId = 0;

  loginForm = { email: 'customer@demo.com', password: 'customer123', role: 'CUSTOMER' as Role };
  registerForm = { name: '', email: '', password: '', consumerNumber: '', address: '', mobile: '', customerType: 'Residential', electricalSection: 'Office' };
  billFilter = '';
  complaintFilter = '';
  adminSearch = '';
  adminSectionFilter = '';
  adminTypeFilter = '';
  adminComplaintStatus = '';
  adminComplaintDepartment = '';
  smeStatus = '';
  smeConsumerNumber = '';

  summary: BillSummary = { totalBills: 0, outstandingAmount: 0, paidAmount: 0 };
  bills: Bill[] = [];
  payments: Payment[] = [];
  complaints: Complaint[] = [];
  customers: Customer[] = [];
  adminComplaints: Complaint[] = [];
  smeComplaints: Complaint[] = [];

  complaintForm = { title: '', department: 'Operations', description: '' };
  customerForm = { name: '', email: '', password: 'customer123', consumerNumber: '', address: '', mobile: '', customerType: 'Residential', electricalSection: 'Office' };
  updateCustomerForm = { id: 0, name: '', email: '', address: '', mobile: '', customerType: 'Residential', electricalSection: 'Office' };
  consumerNumberForm = { customerId: 0, consumerNumber: '' };
  billForm = { customerId: 1, month: 'May 2026', units: 100, amount: 750, dueDate: this.todayPlus(15) };
  bulkBillForm = { customerIds: '', month: 'May 2026', units: 100, amount: 750, dueDate: this.todayPlus(15) };
  statusForm = { complaintId: 0, status: 'IN_PROGRESS', remarks: '' };

  roleTabs = computed(() => {
    const role = this.user()?.role;
    if (role === 'ADMIN') {
      return ['dashboard', 'customers', 'bills', 'complaints'];
    }
    if (role === 'SME') {
      return ['dashboard', 'complaints'];
    }
    return ['dashboard', 'bills', 'payments', 'complaints'];
  });

  constructor(private http: HttpClient) {}

  login(): void {
    this.loading.set(true);
    this.http.post<UserView>(`${this.api}/auth/login`, this.loginForm).subscribe({
      next: user => {
        this.user.set(user);
        this.activeTab.set('dashboard');
        this.showToast(`Logged in as ${user.name}`, 'success');
        this.loadData();
      },
      error: error => this.fail(error),
      complete: () => this.loading.set(false)
    });
  }

  register(): void {
    this.loading.set(true);
    this.http.post<UserView>(`${this.api}/auth/register`, this.registerForm).subscribe({
      next: user => {
        this.user.set(user);
        this.activeTab.set('dashboard');
        this.showToast('Registration completed', 'success');
        this.registerForm = { name: '', email: '', password: '', consumerNumber: '', address: '', mobile: '', customerType: 'Residential', electricalSection: 'Office' };
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

  loadCustomerData(): void {
    const customerId = this.user()?.customerId;
    if (!customerId) {
      return;
    }
    const billStatus = this.billFilter ? `?status=${this.billFilter}` : '';
    const complaintStatus = this.complaintFilter ? `?status=${this.complaintFilter}` : '';
    this.http.get<BillSummary>(`${this.api}/customers/${customerId}/bills/summary`).subscribe(data => this.summary = data);
    this.http.get<Bill[]>(`${this.api}/customers/${customerId}/bills${billStatus}`).subscribe(data => this.bills = data);
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
      bill,
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

  fillDummyCard(): void {
    const gateway = this.paymentGateway();
    if (!gateway) {
      return;
    }
    this.paymentGateway.set({
      ...gateway,
      method: 'card',
      cardName: 'Demo Customer',
      cardNumber: '4242424242424242',
      expiry: '12/30',
      cvv: '123'
    });
  }

  updatePaymentGateway(patch: Partial<PaymentGateway>): void {
    const gateway = this.paymentGateway();
    if (!gateway) {
      return;
    }
    this.paymentGateway.set({ ...gateway, ...patch });
  }

  completeGatewayPayment(): void {
    const customerId = this.user()?.customerId;
    const gateway = this.paymentGateway();
    if (!customerId || !gateway) {
      return;
    }
    const cardLast4 = gateway.method === 'cash' ? 'CASH' : this.validateCardAndGetLast4(gateway);
    if (!cardLast4) {
      return;
    }
    this.payBillConfirmed(gateway.bill, customerId, cardLast4);
  }

  private payBillConfirmed(bill: Bill, customerId: number, cardLast4: string): void {
    this.loading.set(true);
    this.http.post<Payment>(`${this.api}/customers/${customerId}/bills/${bill.id}/pay`, { cardLast4 }).subscribe({
      next: () => {
        this.paymentGateway.set(null);
        this.showToast('Payment completed and receipt generated.', 'success');
        this.loadCustomerData();
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
    this.http.post<Complaint>(`${this.api}/customers/${customerId}/complaints`, this.complaintForm).subscribe({
      next: () => {
        this.showToast('Complaint registered', 'success');
        this.complaintForm = { title: '', department: 'Operations', description: '' };
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
      if (data.length && !this.billForm.customerId) {
        this.billForm.customerId = data[0].id;
      }
    });
  }

  addCustomer(): void {
    this.http.post<Customer>(`${this.api}/admin/customers`, this.customerForm).subscribe({
      next: () => {
        this.showToast('Customer added', 'success');
        this.customerForm = { name: '', email: '', password: 'customer123', consumerNumber: '', address: '', mobile: '', customerType: 'Residential', electricalSection: 'Office' };
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
    this.http.put<Customer>(`${this.api}/admin/customers/${this.updateCustomerForm.id}`, this.updateCustomerForm).subscribe({
      next: () => {
        this.showToast('Customer updated', 'success');
        this.loadCustomers();
      },
      error: error => this.fail(error, 'Customer details could not be updated.')
    });
  }

  addConsumerNumber(): void {
    const { customerId, consumerNumber } = this.consumerNumberForm;
    this.http.post<Customer>(`${this.api}/admin/customers/${customerId}/consumer-numbers`, { consumerNumber }).subscribe({
      next: () => {
        this.showToast('Consumer number added', 'success');
        this.consumerNumberForm.consumerNumber = '';
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
      error: error => this.fail(error, 'Connection status could not be changed.')
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
      error: error => this.fail(error, 'Customer could not be deleted.')
    });
  }

  addBill(): void {
    this.http.post<Bill>(`${this.api}/admin/bills`, this.billForm).subscribe({
      next: () => {
        this.showToast('Bill added', 'success');
        this.loadCustomers();
      },
      error: error => this.fail(error, 'Bill could not be added. Please check the customer and bill details.')
    });
  }

  bulkUploadBills(): void {
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
    const text = `Bill #${bill.id}\nMonth: ${bill.month}\nUnits: ${bill.units}\nAmount: Rs. ${bill.amount}\nDue: ${bill.dueDate}\nStatus: ${bill.status}`;
    this.download(`bill-${bill.id}.txt`, text);
    this.showToast('Bill downloaded', 'info');
  }

  downloadPayment(payment: Payment): void {
    const text = `Payment #${payment.id}\nBill #${payment.billId}\nAmount: Rs. ${payment.amount}\nMode: ${this.paymentMode(payment)}\nPaid At: ${payment.paidAt}`;
    this.download(`payment-${payment.id}.txt`, text);
    this.showToast('Payment receipt downloaded', 'info');
  }

  paymentMode(payment: Payment): string {
    return payment.cardLast4 === 'CASH' ? 'Pay on Cash' : `Card ending ${payment.cardLast4}`;
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

  private download(fileName: string, text: string): void {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  private todayPlus(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private validateCardAndGetLast4(gateway: PaymentGateway): string {
    const digits = gateway.cardNumber.replace(/\D/g, '');
    if (!gateway.cardName.trim()) {
      this.showToast('Enter the card holder name.', 'error');
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
