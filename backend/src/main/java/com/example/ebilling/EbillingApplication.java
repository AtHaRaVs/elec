package com.example.ebilling;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;
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
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

@SpringBootApplication
public class EbillingApplication {
  public static void main(String[] args) {
    SpringApplication.run(EbillingApplication.class, args);
  }
}

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
  List<Customer> customers(@RequestParam Optional<String> search) {
    return store.customers(search);
  }

  @PostMapping("/admin/customers")
  Customer addCustomer(@Valid @RequestBody AdminCustomerRequest request) {
    return store.addCustomer(request.name(), request.email(), request.password(), request.consumerNumber());
  }

  @PutMapping("/admin/customers/{customerId}")
  Customer updateCustomer(@PathVariable long customerId, @Valid @RequestBody UpdateCustomerRequest request) {
    return store.updateCustomer(customerId, request);
  }

  @PostMapping("/admin/customers/{customerId}/consumer-numbers")
  Customer addConsumerNumber(@PathVariable long customerId, @Valid @RequestBody ConsumerNumberRequest request) {
    return store.addConsumerNumber(customerId, request.consumerNumber());
  }

  @PutMapping("/admin/customers/{customerId}/connection")
  Customer updateConnection(@PathVariable long customerId, @Valid @RequestBody ConnectionRequest request) {
    return store.updateConnection(customerId, request.connectionStatus());
  }

  @PostMapping("/admin/bills")
  Bill addBill(@Valid @RequestBody BillRequest request) {
    return store.addBill(request);
  }

  @PostMapping("/admin/bills/bulk")
  List<Bill> bulkBills(@Valid @RequestBody BulkBillRequest request) {
    return request.customerIds().stream()
        .map(customerId -> addBill(new BillRequest(customerId, request.month(), request.units(), request.amount(), request.dueDate())))
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
}

@Repository
class Store {
  private final JdbcTemplate jdbc;

  private final RowMapper<Bill> billMapper = (rs, rowNum) -> new Bill(
      rs.getLong("id"),
      rs.getLong("customer_id"),
      rs.getString("billing_month"),
      rs.getInt("units"),
      rs.getBigDecimal("amount"),
      rs.getDate("due_date").toLocalDate(),
      rs.getString("status")
  );
  private final RowMapper<Complaint> complaintMapper = (rs, rowNum) -> new Complaint(
      rs.getLong("id"),
      rs.getLong("customer_id"),
      rs.getString("title"),
      rs.getString("department"),
      rs.getString("description"),
      rs.getString("status"),
      rs.getString("remarks"),
      rs.getDate("created_on").toLocalDate()
  );
  private final RowMapper<Payment> paymentMapper = (rs, rowNum) -> new Payment(
      rs.getLong("id"),
      rs.getLong("customer_id"),
      rs.getLong("bill_id"),
      rs.getBigDecimal("amount"),
      rs.getString("card_last4"),
      rs.getTimestamp("paid_at").toLocalDateTime()
  );

  Store(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
    createSchema();
    seedIfEmpty();
  }

  UserView register(RegisterRequest request) {
    if (exists("select count(*) from users where lower(email) = lower(?)", request.email())) {
      throw new IllegalArgumentException("Email is already registered");
    }
    return toUserView(addCustomer(request.name(), request.email(), request.password(), request.consumerNumber()), "CUSTOMER");
  }

  UserView login(LoginRequest request) {
    var rows = jdbc.query("""
        select id, name, email, role, customer_id from users
        where lower(email) = lower(?) and password_hash = ? and lower(role) = lower(?)
        """, (rs, rowNum) -> new UserView(
        rs.getLong("id"),
        rs.getString("name"),
        rs.getString("email"),
        rs.getString("role"),
        nullableLong(rs, "customer_id")
    ), request.email(), hash(request.password()), request.role());
    return rows.stream().findFirst().orElseThrow(() -> new IllegalArgumentException("Invalid login details"));
  }

  List<Bill> customerBills(long customerId, Optional<String> status) {
    if (status.isPresent() && !status.get().isBlank()) {
      return jdbc.query("""
          select * from bills where customer_id = ? and lower(status) = lower(?)
          order by due_date desc, id desc
          """, billMapper, customerId, status.get());
    }
    return jdbc.query("select * from bills where customer_id = ? order by due_date desc, id desc", billMapper, customerId);
  }

  Payment payBill(long customerId, long billId, PayRequest request) {
    var bill = requireBill(billId);
    if (bill.customerId != customerId) {
      throw new NotFoundException("Bill does not belong to this customer");
    }
    jdbc.update("update bills set status = 'PAID' where id = ?", billId);
    var paidAt = LocalDateTime.now();
    long id = insert("""
        insert into payments(customer_id, bill_id, amount, card_last4, paid_at)
        values (?, ?, ?, ?, ?)
        """, customerId, billId, bill.amount, request.cardLast4(), Timestamp.valueOf(paidAt));
    return new Payment(id, customerId, billId, bill.amount, request.cardLast4(), paidAt);
  }

  List<Payment> payments(long customerId) {
    return jdbc.query("select * from payments where customer_id = ? order by paid_at desc, id desc", paymentMapper, customerId);
  }

  Complaint createComplaint(long customerId, ComplaintRequest request) {
    requireCustomer(customerId);
    var createdOn = LocalDate.now();
    long id = insert("""
        insert into complaints(customer_id, title, department, description, status, remarks, created_on)
        values (?, ?, ?, ?, 'OPEN', '', ?)
        """, customerId, request.title(), request.department(), request.description(), Date.valueOf(createdOn));
    return new Complaint(id, customerId, request.title(), request.department(), request.description(), "OPEN", "", createdOn);
  }

  List<Complaint> customerComplaints(long customerId, Optional<String> status) {
    if (status.isPresent() && !status.get().isBlank()) {
      return jdbc.query("""
          select * from complaints where customer_id = ? and lower(status) = lower(?)
          order by created_on desc, id desc
          """, complaintMapper, customerId, status.get());
    }
    return jdbc.query("select * from complaints where customer_id = ? order by created_on desc, id desc", complaintMapper, customerId);
  }

  List<Customer> customers(Optional<String> search) {
    var term = "%" + search.orElse("").toLowerCase(Locale.ROOT) + "%";
    var ids = jdbc.queryForList("""
        select c.id from customers c
        left join consumer_numbers cn on cn.customer_id = c.id
        where lower(c.name) like ? or lower(c.email) like ? or lower(cn.consumer_number) like ?
        group by c.id, c.name
        order by c.name
        """, Long.class, term, term, term);
    return ids.stream().map(this::requireCustomer).toList();
  }

  Customer addCustomer(String name, String email, String password, String consumerNumber) {
    if (exists("select count(*) from customers where lower(email) = lower(?)", email)) {
      throw new IllegalArgumentException("Customer email already exists");
    }
    if (exists("select count(*) from consumer_numbers where consumer_number = ?", consumerNumber)) {
      throw new IllegalArgumentException("Consumer number already exists");
    }
    long customerId = insert("""
        insert into customers(name, email, address, mobile, customer_type, electrical_section, connection_status)
        values (?, ?, '', '', 'Residential', 'Office', 'ACTIVE')
        """, name, email);
    jdbc.update("insert into consumer_numbers(customer_id, consumer_number) values (?, ?)", customerId, consumerNumber);
    jdbc.update("""
        insert into users(id, name, email, password_hash, role, customer_id)
        values (?, ?, ?, ?, 'CUSTOMER', ?)
        """, customerId, name, email, hash(password), customerId);
    return requireCustomer(customerId);
  }

  Customer updateCustomer(long customerId, UpdateCustomerRequest request) {
    requireCustomer(customerId);
    jdbc.update("update customers set name = ?, email = ? where id = ?", request.name(), request.email(), customerId);
    jdbc.update("update users set name = ?, email = ? where customer_id = ?", request.name(), request.email(), customerId);
    return requireCustomer(customerId);
  }

  Customer addConsumerNumber(long customerId, String consumerNumber) {
    requireCustomer(customerId);
    if (!exists("select count(*) from consumer_numbers where customer_id = ? and consumer_number = ?", customerId, consumerNumber)) {
      if (exists("select count(*) from consumer_numbers where consumer_number = ?", consumerNumber)) {
        throw new IllegalArgumentException("Consumer number already exists");
      }
      jdbc.update("insert into consumer_numbers(customer_id, consumer_number) values (?, ?)", customerId, consumerNumber);
    }
    return requireCustomer(customerId);
  }

  Customer updateConnection(long customerId, String connectionStatus) {
    requireCustomer(customerId);
    jdbc.update("update customers set connection_status = ? where id = ?", connectionStatus, customerId);
    return requireCustomer(customerId);
  }

  Bill addBill(BillRequest request) {
    requireCustomer(request.customerId());
    long id = insert("""
        insert into bills(customer_id, billing_month, units, amount, due_date, status)
        values (?, ?, ?, ?, ?, 'UNPAID')
        """, request.customerId(), request.month(), request.units(), request.amount(), Date.valueOf(request.dueDate()));
    return requireBill(id);
  }

  List<Complaint> filteredComplaints(Optional<String> status, Optional<String> department, Optional<String> consumerNumber) {
    return jdbc.query("""
        select distinct c.* from complaints c
        join customers cust on cust.id = c.customer_id
        left join consumer_numbers cn on cn.customer_id = cust.id
        where (? is null or lower(c.status) = lower(?))
          and (? is null or lower(c.department) = lower(?))
          and (? is null or cn.consumer_number = ?)
        order by c.created_on desc, c.id desc
        """, complaintMapper,
        blankToNull(status), blankToNull(status),
        blankToNull(department), blankToNull(department),
        blankToNull(consumerNumber), blankToNull(consumerNumber));
  }

  Complaint updateComplaint(long complaintId, ComplaintUpdateRequest request) {
    requireComplaint(complaintId);
    jdbc.update("update complaints set status = ?, remarks = ? where id = ?", request.status(), request.remarks(), complaintId);
    return requireComplaint(complaintId);
  }

  void deleteCustomer(long customerId) {
    requireCustomer(customerId);
    jdbc.update("delete from customers where id = ?", customerId);
  }

  Customer requireCustomer(long id) {
    var rows = jdbc.query("select * from customers where id = ?", (rs, rowNum) -> new Customer(
        rs.getLong("id"),
        rs.getString("name"),
        rs.getString("email"),
        consumerNumbers(rs.getLong("id")),
        rs.getString("connection_status")
    ), id);
    return rows.stream().findFirst().orElseThrow(() -> new NotFoundException("Customer not found"));
  }

  Bill requireBill(long id) {
    return jdbc.query("select * from bills where id = ?", billMapper, id)
        .stream().findFirst().orElseThrow(() -> new NotFoundException("Bill not found"));
  }

  Complaint requireComplaint(long id) {
    return jdbc.query("select * from complaints where id = ?", complaintMapper, id)
        .stream().findFirst().orElseThrow(() -> new NotFoundException("Complaint not found"));
  }

  private void createSchema() {
    jdbc.execute("""
        create table if not exists customers(
          id bigint generated by default as identity primary key,
          name varchar(120) not null,
          email varchar(160) not null unique,
          address varchar(255) not null,
          mobile varchar(20) not null,
          customer_type varchar(40) not null,
          electrical_section varchar(80) not null,
          connection_status varchar(30) not null
        )
        """);
    jdbc.execute("""
        create table if not exists consumer_numbers(
          id bigint generated by default as identity primary key,
          customer_id bigint not null references customers(id) on delete cascade,
          consumer_number varchar(30) not null unique
        )
        """);
    jdbc.execute("""
        create table if not exists users(
          id bigint primary key,
          name varchar(120) not null,
          email varchar(160) not null unique,
          password_hash varchar(80) not null,
          role varchar(30) not null,
          customer_id bigint references customers(id) on delete cascade
        )
        """);
    jdbc.execute("""
        create table if not exists bills(
          id bigint generated by default as identity primary key,
          customer_id bigint not null references customers(id) on delete cascade,
          billing_month varchar(40) not null,
          units int not null,
          amount decimal(12,2) not null,
          due_date date not null,
          status varchar(30) not null
        )
        """);
    jdbc.execute("""
        create table if not exists payments(
          id bigint generated by default as identity primary key,
          customer_id bigint not null references customers(id) on delete cascade,
          bill_id bigint not null references bills(id) on delete cascade,
          amount decimal(12,2) not null,
          card_last4 varchar(4) not null,
          paid_at timestamp not null
        )
        """);
    jdbc.execute("""
        create table if not exists complaints(
          id bigint generated by default as identity primary key,
          customer_id bigint not null references customers(id) on delete cascade,
          title varchar(160) not null,
          department varchar(80) not null,
          description varchar(1000) not null,
          status varchar(30) not null,
          remarks varchar(1000),
          created_on date not null
        )
        """);
  }

  private void seedIfEmpty() {
    if (jdbc.queryForObject("select count(*) from customers", Integer.class) > 0) {
      return;
    }
    seedCustomer(1, "Asha Customer", "customer@demo.com", "CN1001", "ACTIVE");
    seedCustomer(2, "Ravi Customer", "ravi@demo.com", "CN1002", "ACTIVE");
    seedCustomer(3, "Meera Shah", "meera@demo.com", "CN1003", "ACTIVE");
    seedCustomer(4, "Kabir Rao", "kabir@demo.com", "CN1004", "DISCONNECTED");
    seedCustomer(5, "Nisha Patel", "nisha@demo.com", "CN1005", "ACTIVE");
    seedCustomer(6, "Dev Singh", "dev@demo.com", "CN1006", "ACTIVE");
    seedCustomer(7, "Isha Menon", "isha@demo.com", "CN1007", "ACTIVE");
    seedCustomer(8, "Arjun Das", "arjun@demo.com", "CN1008", "DISCONNECTED");
    seedCustomer(9, "Pooja Nair", "pooja@demo.com", "CN1009", "ACTIVE");
    seedCustomer(10, "Vikram Joshi", "vikram@demo.com", "CN1010", "ACTIVE");
    jdbc.update("insert into users(id, name, email, password_hash, role, customer_id) values (1001, 'Admin User', 'admin@demo.com', ?, 'ADMIN', null)", hash("admin123"));
    jdbc.update("insert into users(id, name, email, password_hash, role, customer_id) values (1002, 'SME User', 'sme@demo.com', ?, 'SME', null)", hash("sme123"));

    seedBill(1, 1, "April 2026", 214, "1825.00", 12, "UNPAID");
    seedBill(2, 1, "March 2026", 190, "1540.00", -18, "PAID");
    seedBill(3, 2, "April 2026", 128, "985.00", 10, "UNPAID");
    seedBill(4, 3, "April 2026", 176, "1320.00", 9, "UNPAID");
    seedBill(5, 4, "April 2026", 88, "690.00", -4, "UNPAID");
    seedBill(6, 5, "March 2026", 245, "2050.00", -20, "PAID");
    seedBill(7, 6, "April 2026", 156, "1180.00", 14, "UNPAID");
    seedBill(8, 7, "February 2026", 202, "1715.00", -45, "PAID");
    seedBill(9, 8, "April 2026", 99, "765.00", 5, "UNPAID");
    seedBill(10, 9, "March 2026", 134, "1025.00", -10, "PAID");
    seedBill(11, 10, "April 2026", 223, "1890.00", 7, "UNPAID");
    seedBill(12, 2, "March 2026", 111, "860.00", -25, "PAID");
    seedPayment(1, 1, 2, "1540.00", "4242", 16);
    seedPayment(2, 5, 6, "2050.00", "1111", 18);
    seedPayment(3, 7, 8, "1715.00", "2222", 42);
    seedPayment(4, 9, 10, "1025.00", "3333", 8);
    seedPayment(5, 2, 12, "860.00", "4444", 20);
    seedComplaint(1, 1, "Frequent power failure", "Operations", "Power has failed multiple times this week.", "OPEN", "", 1);
    seedComplaint(2, 2, "Meter reading mismatch", "Billing", "Current bill units look higher than meter reading.", "IN_PROGRESS", "Assigned to billing team", 3);
    seedComplaint(3, 3, "Loose service wire", "Operations", "Wire near the entrance is loose after rain.", "OPEN", "", 2);
    seedComplaint(4, 4, "Reconnect request", "Operations", "Payment made, please reconnect supply.", "IN_PROGRESS", "Technician visit scheduled", 5);
    seedComplaint(5, 5, "Bill not generated", "Billing", "April bill is not visible in portal.", "RESOLVED", "Bill regenerated", 8);
    jdbc.execute("alter table customers alter column id restart with 11");
    jdbc.execute("alter table bills alter column id restart with 13");
    jdbc.execute("alter table payments alter column id restart with 6");
    jdbc.execute("alter table complaints alter column id restart with 6");
  }

  private void seedCustomer(long id, String name, String email, String consumerNumber, String status) {
    jdbc.update("""
        insert into customers(id, name, email, address, mobile, customer_type, electrical_section, connection_status)
        values (?, ?, ?, 'Demo address', '9999999999', 'Residential', 'Office', ?)
        """, id, name, email, status);
    jdbc.update("insert into consumer_numbers(customer_id, consumer_number) values (?, ?)", id, consumerNumber);
    jdbc.update("insert into users(id, name, email, password_hash, role, customer_id) values (?, ?, ?, ?, 'CUSTOMER', ?)",
        id, name, email, hash("customer123"), id);
  }

  private void seedBill(long id, long customerId, String month, int units, String amount, int dueInDays, String status) {
    jdbc.update("insert into bills(id, customer_id, billing_month, units, amount, due_date, status) values (?, ?, ?, ?, ?, ?, ?)",
        id, customerId, month, units, new BigDecimal(amount), Date.valueOf(LocalDate.now().plusDays(dueInDays)), status);
  }

  private void seedPayment(long id, long customerId, long billId, String amount, String cardLast4, int paidDaysAgo) {
    jdbc.update("insert into payments(id, customer_id, bill_id, amount, card_last4, paid_at) values (?, ?, ?, ?, ?, ?)",
        id, customerId, billId, new BigDecimal(amount), cardLast4, Timestamp.valueOf(LocalDateTime.now().minusDays(paidDaysAgo)));
  }

  private void seedComplaint(long id, long customerId, String title, String department, String description, String status, String remarks, int daysAgo) {
    jdbc.update("""
        insert into complaints(id, customer_id, title, department, description, status, remarks, created_on)
        values (?, ?, ?, ?, ?, ?, ?, ?)
        """, id, customerId, title, department, description, status, remarks, Date.valueOf(LocalDate.now().minusDays(daysAgo)));
  }

  private List<String> consumerNumbers(long customerId) {
    return jdbc.queryForList("select consumer_number from consumer_numbers where customer_id = ? order by id", String.class, customerId);
  }

  private UserView toUserView(Customer customer, String role) {
    return new UserView(customer.id, customer.name, customer.email, role, customer.id);
  }

  private long insert(String sql, Object... args) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbc.update(connection -> {
      PreparedStatement ps = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
      for (int i = 0; i < args.length; i++) {
        ps.setObject(i + 1, args[i]);
      }
      return ps;
    }, keyHolder);
    return keyHolder.getKey().longValue();
  }

  private boolean exists(String sql, Object... args) {
    return jdbc.queryForObject(sql, Integer.class, args) > 0;
  }

  private Long nullableLong(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
    long value = rs.getLong(column);
    return rs.wasNull() ? null : value;
  }

  private String blankToNull(Optional<String> value) {
    return value.filter(text -> !text.isBlank()).orElse(null);
  }

  private String hash(String value) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes()));
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("SHA-256 is unavailable", exception);
    }
  }
}

class Customer {
  public long id;
  public String name;
  public String email;
  public List<String> consumerNumbers;
  public String connectionStatus;

  Customer(long id, String name, String email, List<String> consumerNumbers, String connectionStatus) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.consumerNumbers = new ArrayList<>(consumerNumbers);
    this.connectionStatus = connectionStatus;
  }
}

class Bill {
  public long id;
  public long customerId;
  public String month;
  public int units;
  public BigDecimal amount;
  public LocalDate dueDate;
  public String status;

  Bill(long id, long customerId, String month, int units, BigDecimal amount, LocalDate dueDate, String status) {
    this.id = id;
    this.customerId = customerId;
    this.month = month;
    this.units = units;
    this.amount = amount;
    this.dueDate = dueDate;
    this.status = status;
  }
}

class Complaint {
  public long id;
  public long customerId;
  public String title;
  public String department;
  public String description;
  public String status;
  public String remarks;
  public LocalDate createdOn;

  Complaint(long id, long customerId, String title, String department, String description, String status, String remarks, LocalDate createdOn) {
    this.id = id;
    this.customerId = customerId;
    this.title = title;
    this.department = department;
    this.description = description;
    this.status = status;
    this.remarks = remarks;
    this.createdOn = createdOn;
  }
}

record UserView(long id, String name, String email, String role, Long customerId) {}
record BillSummary(int totalBills, BigDecimal outstandingAmount, BigDecimal paidAmount) {}
record Payment(long id, long customerId, long billId, BigDecimal amount, String cardLast4, LocalDateTime paidAt) {}
record RegisterRequest(@NotBlank String name, @Email String email, @NotBlank String password, @NotBlank String consumerNumber) {}
record LoginRequest(@Email String email, @NotBlank String password, @NotBlank String role) {}
record PayRequest(@NotBlank String cardLast4) {}
record ComplaintRequest(@NotBlank String title, @NotBlank String department, @NotBlank String description) {}
record ComplaintUpdateRequest(@NotBlank String status, String remarks) {}
record AdminCustomerRequest(@NotBlank String name, @Email String email, @NotBlank String password, @NotBlank String consumerNumber) {}
record UpdateCustomerRequest(@NotBlank String name, @Email String email) {}
record ConsumerNumberRequest(@NotBlank String consumerNumber) {}
record ConnectionRequest(@NotBlank String connectionStatus) {}
record BillRequest(@NotNull Long customerId, @NotBlank String month, int units, @NotNull BigDecimal amount, @NotNull LocalDate dueDate) {}
record BulkBillRequest(@NotNull List<Long> customerIds, @NotBlank String month, int units, @NotNull BigDecimal amount, @NotNull LocalDate dueDate) {}

class NotFoundException extends RuntimeException {
  NotFoundException(String message) {
    super(message);
  }
}
