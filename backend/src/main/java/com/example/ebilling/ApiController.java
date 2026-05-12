package com.example.ebilling;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "http://localhost:4200")
class ApiController {
  private final Store store;

  ApiController(Store store) {
    this.store = store;
  }

  @PostMapping("/auth/register")
  UserView register(@Valid @RequestBody RegisterRequest request) {
    return store.register(request);
  }

  @PostMapping("/auth/login")
  UserView login(@Valid @RequestBody LoginRequest request) {
    return store.login(request);
  }

  @GetMapping("/customers/{customerId}/bills")
  List<Bill> customerBills(@PathVariable long customerId, @RequestParam Optional<String> status) {
    store.requireCustomer(customerId);
    return store.customerBills(customerId, status);
  }

  @GetMapping("/customers/{customerId}/bills/summary")
  BillSummary billSummary(@PathVariable long customerId) {
    var bills = customerBills(customerId, Optional.empty());
    var outstanding = bills.stream()
        .filter(bill -> "UNPAID".equals(bill.status))
        .map(bill -> bill.amount)
        .reduce(BigDecimal.ZERO, BigDecimal::add);
    var paid = bills.stream()
        .filter(bill -> "PAID".equals(bill.status))
        .map(bill -> bill.amount)
        .reduce(BigDecimal.ZERO, BigDecimal::add);
    return new BillSummary(bills.size(), outstanding, paid);
  }

  @PostMapping("/customers/{customerId}/bills/{billId}/pay")
  Payment payBill(@PathVariable long customerId, @PathVariable long billId, @Valid @RequestBody PayRequest request) {
    return store.payBill(customerId, billId, request);
  }

  @GetMapping("/customers/{customerId}/payments")
  List<Payment> payments(@PathVariable long customerId) {
    store.requireCustomer(customerId);
    return store.payments(customerId);
  }

  @PostMapping("/customers/{customerId}/complaints")
  Complaint createComplaint(@PathVariable long customerId, @Valid @RequestBody ComplaintRequest request) {
    return store.createComplaint(customerId, request);
  }

  @GetMapping("/customers/{customerId}/complaints")
  List<Complaint> customerComplaints(@PathVariable long customerId, @RequestParam Optional<String> status) {
    store.requireCustomer(customerId);
    return store.customerComplaints(customerId, status);
  }

  @GetMapping("/admin/customers")
  List<Customer> customers(
      @RequestParam Optional<String> search,
      @RequestParam Optional<String> electricalSection,
      @RequestParam Optional<String> customerType
  ) {
    return store.customers(search, electricalSection, customerType);
  }

  @PostMapping("/admin/customers")
  Customer addCustomer(@Valid @RequestBody AdminCustomerRequest request) {
    return store.addCustomer(request);
  }

  @PutMapping("/admin/customers/{customerId}")
  Customer updateCustomer(@PathVariable long customerId, @Valid @RequestBody UpdateCustomerRequest request) {
    return store.updateCustomer(customerId, request);
  }

  @PostMapping("/admin/customers/{customerId}/consumer-numbers")
  Customer addConsumerNumber(@PathVariable long customerId) {
    return store.addConsumerNumber(customerId);
  }

  @PutMapping("/admin/customers/{customerId}/connection")
  Customer updateConnection(@PathVariable long customerId, @Valid @RequestBody ConnectionRequest request) {
    return store.updateConnection(customerId, request.connectionStatus());
  }

  @PutMapping("/users/{userId}/profile")
  UserView updateProfile(@PathVariable long userId, @Valid @RequestBody ProfileRequest request) {
    return store.updateProfile(userId, request);
  }

  @PostMapping("/admin/bills")
  Bill addBill(@Valid @RequestBody BillRequest request) {
    return store.addBill(request);
  }

  @PostMapping("/admin/bills/bulk")
  List<Bill> bulkBills(@Valid @RequestBody BulkBillRequest request) {
    return request.customerIds().stream()
        .flatMap(customerId -> store.consumerNumbers(customerId).stream()
            .map(consumerNumber -> addBill(new BillRequest(customerId, consumerNumber, request.month(), request.units(), request.amount(), request.dueDate()))))
        .toList();
  }

  @GetMapping("/admin/complaints")
  List<Complaint> adminComplaints(@RequestParam Optional<String> status, @RequestParam Optional<String> department) {
    return store.filteredComplaints(status, department, Optional.empty());
  }

  @PutMapping("/admin/complaints/{complaintId}")
  Complaint updateComplaint(@PathVariable long complaintId, @Valid @RequestBody ComplaintUpdateRequest request) {
    return store.updateComplaint(complaintId, request);
  }

  @DeleteMapping("/admin/customers/{customerId}")
  void deleteCustomer(@PathVariable long customerId) {
    store.deleteCustomer(customerId);
  }

  @GetMapping("/sme/complaints")
  List<Complaint> smeComplaints(@RequestParam Optional<String> status, @RequestParam Optional<String> consumerNumber) {
    return store.filteredComplaints(status, Optional.empty(), consumerNumber);
  }

  @PutMapping("/sme/complaints/{complaintId}/act")
  Complaint actOnComplaint(@PathVariable long complaintId, @Valid @RequestBody ComplaintUpdateRequest request) {
    return updateComplaint(complaintId, request);
  }

  @ExceptionHandler(NotFoundException.class)
  @ResponseStatus(HttpStatus.NOT_FOUND)
  Map<String, String> notFound(NotFoundException exception) {
    return Map.of("message", exception.getMessage());
  }

  @ExceptionHandler(IllegalArgumentException.class)
  @ResponseStatus(HttpStatus.BAD_REQUEST)
  Map<String, String> badRequest(IllegalArgumentException exception) {
    return Map.of("message", exception.getMessage());
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  @ResponseStatus(HttpStatus.BAD_REQUEST)
  Map<String, String> validationError() {
    return Map.of("message", "Please fill all required fields correctly");
  }
}
