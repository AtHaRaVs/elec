package com.example.ebilling;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

@Repository
class Store {
  private final JdbcTemplate jdbc;
  private static final Pattern MOBILE = Pattern.compile("\\d{10}");
  private static final Pattern NAME = Pattern.compile("[A-Za-z ]{2,50}");
  private static final Pattern STRONG_PASSWORD = Pattern.compile("^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{8,}$");
  private static final BigDecimal MAX_BILL_AMOUNT = new BigDecimal("5000.00");
  private static final DateTimeFormatter BILLING_MONTH = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.ENGLISH);

  private final RowMapper<Bill> billMapper = (rs, rowNum) -> new Bill(
      rs.getLong("id"),
      rs.getLong("customer_id"),
      rs.getString("consumer_number"),
      rs.getString("billing_month"),
      rs.getInt("units"),
      rs.getBigDecimal("amount"),
      rs.getDate("due_date").toLocalDate(),
      rs.getString("status")
  );

  private final RowMapper<Complaint> complaintMapper = (rs, rowNum) -> new Complaint(
      rs.getLong("id"),
      rs.getLong("customer_id"),
      nullableLong(rs, "bill_id"),
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
    return toUserView(addCustomer(new AdminCustomerRequest(
        request.name(),
        request.email(),
        request.password(),
        request.address(),
        request.mobile(),
        request.customerType(),
        request.electricalSection()
    )), "CUSTOMER");
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
    if ("PAID".equalsIgnoreCase(bill.status)) {
      throw new IllegalArgumentException("Bill is already paid");
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
    if (request.billId() != null) {
      var bill = requireBill(request.billId());
      if (bill.customerId != customerId) {
        throw new IllegalArgumentException("Bill ID does not belong to this customer");
      }
    }
    var createdOn = LocalDate.now();
    long id = insert("""
        insert into complaints(customer_id, bill_id, title, department, description, status, remarks, created_on)
        values (?, ?, ?, ?, ?, 'OPEN', '', ?)
        """, customerId, request.billId(), request.title(), request.department(), request.description(), Date.valueOf(createdOn));
    return new Complaint(id, customerId, request.billId(), request.title(), request.department(), request.description(), "OPEN", "", createdOn);
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

  List<Customer> customers(Optional<String> search, Optional<String> electricalSection, Optional<String> customerType) {
    var term = "%" + search.orElse("").toLowerCase(Locale.ROOT) + "%";
    var ids = jdbc.queryForList("""
        select c.id from customers c
        left join consumer_numbers cn on cn.customer_id = c.id
        where (lower(c.name) like ? or lower(c.email) like ? or lower(cn.consumer_number) like ?
          or cast(c.id as varchar) like ?)
          and (? is null or lower(c.electrical_section) = lower(?))
          and (? is null or lower(c.customer_type) = lower(?))
        group by c.id, c.name
        order by c.name
        """, Long.class, term, term, term, term,
        blankToNull(electricalSection), blankToNull(electricalSection),
        blankToNull(customerType), blankToNull(customerType));
    return ids.stream().map(this::requireCustomer).toList();
  }

  Customer addCustomer(AdminCustomerRequest request) {
    validateCustomerRequest(request);
    if (exists("select count(*) from customers where lower(email) = lower(?)", request.email())) {
      throw new IllegalArgumentException("Customer email already exists");
    }
    long customerId = insert("""
        insert into customers(name, email, address, mobile, customer_type, electrical_section, connection_status)
        values (?, ?, ?, ?, ?, ?, 'ACTIVE')
        """, request.name(), request.email(), request.address(), request.mobile(), request.customerType(), request.electricalSection());
    jdbc.update("insert into consumer_numbers(customer_id, consumer_number) values (?, ?)", customerId, generateConsumerNumber(customerId, 1));
    jdbc.update("""
        insert into users(id, name, email, password_hash, role, customer_id)
        values (?, ?, ?, ?, 'CUSTOMER', ?)
        """, customerId, request.name(), request.email(), hash(request.password()), customerId);
    return requireCustomer(customerId);
  }

  Customer updateCustomer(long customerId, UpdateCustomerRequest request) {
    requireCustomer(customerId);
    validateCustomerProfile(request.name(), request.email(), request.address(), request.mobile());
    jdbc.update("""
        update customers
        set name = ?, email = ?, address = ?, mobile = ?, customer_type = ?, electrical_section = ?
        where id = ?
        """, request.name(), request.email(), request.address(), request.mobile(),
        request.customerType(), request.electricalSection(), customerId);
    jdbc.update("update users set name = ?, email = ? where customer_id = ?", request.name(), request.email(), customerId);
    return requireCustomer(customerId);
  }

  Customer addConsumerNumber(long customerId) {
    requireCustomer(customerId);
    int count = jdbc.queryForObject("select count(*) from consumer_numbers where customer_id = ?", Integer.class, customerId);
    if (count >= 5) {
      throw new IllegalArgumentException("A customer can have a maximum of 5 consumers");
    }
    jdbc.update("insert into consumer_numbers(customer_id, consumer_number) values (?, ?)", customerId, generateConsumerNumber(customerId, count + 1));
    return requireCustomer(customerId);
  }

  Customer updateConnection(long customerId, String connectionStatus) {
    requireCustomer(customerId);
    if ("DISCONNECTED".equalsIgnoreCase(connectionStatus) && hasUnpaidBills(customerId)) {
      throw new IllegalArgumentException("Unpaid bills must be paid before disconnecting this customer");
    }
    jdbc.update("update customers set connection_status = ? where id = ?", connectionStatus, customerId);
    return requireCustomer(customerId);
  }

  UserView updateProfile(long userId, ProfileRequest request) {
    var user = requireUser(userId);
    if (!NAME.matcher(request.name().trim()).matches()) {
      throw new IllegalArgumentException("Name should contain only characters and be under 50 characters");
    }
    if (exists("select count(*) from users where lower(email) = lower(?) and id <> ?", request.email(), userId)) {
      throw new IllegalArgumentException("Email is already registered");
    }
    jdbc.update("update users set name = ?, email = ? where id = ?", request.name(), request.email(), userId);
    if (user.customerId() != null) {
      validateCustomerProfile(request.name(), request.email(), request.address(), request.mobile());
      jdbc.update("""
          update customers
          set name = ?, email = ?, address = ?, mobile = ?, customer_type = ?, electrical_section = ?
          where id = ?
          """, request.name(), request.email(), request.address(), request.mobile(), request.customerType(), request.electricalSection(), user.customerId());
    }
    return requireUser(userId);
  }

  Bill addBill(BillRequest request) {
    validateBillRequest(request);
    long id = insert("""
        insert into bills(customer_id, consumer_number, billing_month, units, amount, due_date, status)
        values (?, ?, ?, ?, ?, ?, 'UNPAID')
        """, request.customerId(), request.consumerNumber(), normalizedMonth(request.month()), request.units(), request.amount(), Date.valueOf(request.dueDate()));
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
    var complaint = requireComplaint(complaintId);
    if ("RESOLVED".equalsIgnoreCase(complaint.status)) {
      throw new IllegalArgumentException("Closed complaints cannot be changed");
    }
    jdbc.update("update complaints set status = ?, remarks = ? where id = ?", request.status(), request.remarks(), complaintId);
    return requireComplaint(complaintId);
  }

  void deleteCustomer(long customerId) {
    requireCustomer(customerId);
    if (hasUnpaidBills(customerId)) {
      throw new IllegalArgumentException("Unpaid bills must be paid before deleting this customer");
    }
    jdbc.update("delete from customers where id = ?", customerId);
  }

  Customer requireCustomer(long id) {
    var rows = jdbc.query("select * from customers where id = ?", (rs, rowNum) -> new Customer(
        rs.getLong("id"),
        rs.getString("name"),
        rs.getString("email"),
        consumerNumbers(rs.getLong("id")),
        rs.getString("connection_status"),
        rs.getString("address"),
        rs.getString("mobile"),
        rs.getString("customer_type"),
        rs.getString("electrical_section")
    ), id);
    return rows.stream().findFirst().orElseThrow(() -> new NotFoundException("Customer not found"));
  }

  List<String> consumerNumbers(long customerId) {
    return jdbc.queryForList("select consumer_number from consumer_numbers where customer_id = ? order by id", String.class, customerId);
  }

  private UserView requireUser(long userId) {
    return jdbc.query("""
        select id, name, email, role, customer_id from users where id = ?
        """, (rs, rowNum) -> new UserView(
        rs.getLong("id"),
        rs.getString("name"),
        rs.getString("email"),
        rs.getString("role"),
        nullableLong(rs, "customer_id")
    ), userId).stream().findFirst().orElseThrow(() -> new NotFoundException("User not found"));
  }

  private Bill requireBill(long id) {
    return jdbc.query("select * from bills where id = ?", billMapper, id)
        .stream().findFirst().orElseThrow(() -> new NotFoundException("Bill not found"));
  }

  private Complaint requireComplaint(long id) {
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
          consumer_number varchar(30) not null,
          billing_month varchar(40) not null,
          units int not null,
          amount decimal(12,2) not null,
          due_date date not null,
          status varchar(30) not null
        )
        """);
    jdbc.execute("alter table bills add column if not exists consumer_number varchar(30)");
    jdbc.update("""
        update bills b set consumer_number = (
          select min(cn.consumer_number) from consumer_numbers cn where cn.customer_id = b.customer_id
        )
        where consumer_number is null or consumer_number = ''
        """);
    jdbc.execute("alter table bills alter column consumer_number set not null");
    jdbc.execute("create unique index if not exists uq_bill_consumer_month on bills(consumer_number, billing_month)");
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
          bill_id bigint,
          title varchar(160) not null,
          department varchar(80) not null,
          description varchar(1000) not null,
          status varchar(30) not null,
          remarks varchar(1000),
          created_on date not null
        )
        """);
    jdbc.execute("alter table complaints add column if not exists bill_id bigint");
  }

  private void seedIfEmpty() {
    if (jdbc.queryForObject("select count(*) from customers", Integer.class) > 0) {
      return;
    }
    seedCustomer(1, "Asha Customer", "customer@demo.com", "0000000010001", "ACTIVE");
    seedCustomer(2, "Ravi Customer", "ravi@demo.com", "0000000020001", "ACTIVE");
    seedCustomer(3, "Meera Shah", "meera@demo.com", "0000000030001", "ACTIVE");
    seedCustomer(4, "Kabir Rao", "kabir@demo.com", "0000000040001", "DISCONNECTED");
    seedCustomer(5, "Nisha Patel", "nisha@demo.com", "0000000050001", "ACTIVE");
    seedCustomer(6, "Dev Singh", "dev@demo.com", "0000000060001", "ACTIVE");
    seedCustomer(7, "Isha Menon", "isha@demo.com", "0000000070001", "ACTIVE");
    seedCustomer(8, "Arjun Das", "arjun@demo.com", "0000000080001", "DISCONNECTED");
    seedCustomer(9, "Pooja Nair", "pooja@demo.com", "0000000090001", "ACTIVE");
    seedCustomer(10, "Vikram Joshi", "vikram@demo.com", "0000000100001", "ACTIVE");
    jdbc.update("insert into users(id, name, email, password_hash, role, customer_id) values (1001, 'Admin User', 'admin@demo.com', ?, 'ADMIN', null)", hash("admin123"));
    jdbc.update("insert into users(id, name, email, password_hash, role, customer_id) values (1002, 'SME User', 'sme@demo.com', ?, 'SME', null)", hash("sme123"));

    seedBill(1, 1, "0000000010001", "April 2026", 214, "1825.00", 0, "UNPAID");
    seedBill(2, 1, "0000000010001", "March 2026", 190, "1540.00", -18, "PAID");
    seedBill(3, 2, "0000000020001", "April 2026", 128, "985.00", 0, "UNPAID");
    seedBill(4, 3, "0000000030001", "April 2026", 176, "1320.00", -1, "UNPAID");
    seedBill(5, 4, "0000000040001", "April 2026", 88, "690.00", -4, "UNPAID");
    seedBill(6, 5, "0000000050001", "March 2026", 245, "2050.00", -20, "PAID");
    seedBill(7, 6, "0000000060001", "April 2026", 156, "1180.00", -2, "UNPAID");
    seedBill(8, 7, "0000000070001", "February 2026", 202, "1715.00", -30, "PAID");
    seedBill(9, 8, "0000000080001", "April 2026", 99, "765.00", -5, "UNPAID");
    seedBill(10, 9, "0000000090001", "March 2026", 134, "1025.00", -10, "PAID");
    seedBill(11, 10, "0000000100001", "April 2026", 223, "1890.00", -7, "UNPAID");
    seedBill(12, 2, "0000000020001", "March 2026", 111, "860.00", -25, "PAID");
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

  private void seedBill(long id, long customerId, String consumerNumber, String month, int units, String amount, int dueInDays, String status) {
    jdbc.update("insert into bills(id, customer_id, consumer_number, billing_month, units, amount, due_date, status) values (?, ?, ?, ?, ?, ?, ?, ?)",
        id, customerId, consumerNumber, month, units, new BigDecimal(amount), Date.valueOf(LocalDate.now().plusDays(dueInDays)), status);
  }

  private void seedPayment(long id, long customerId, long billId, String amount, String cardLast4, int paidDaysAgo) {
    jdbc.update("insert into payments(id, customer_id, bill_id, amount, card_last4, paid_at) values (?, ?, ?, ?, ?, ?)",
        id, customerId, billId, new BigDecimal(amount), cardLast4, Timestamp.valueOf(LocalDateTime.now().minusDays(paidDaysAgo)));
  }

  private void seedComplaint(long id, long customerId, String title, String department, String description, String status, String remarks, int daysAgo) {
    jdbc.update("""
        insert into complaints(id, customer_id, bill_id, title, department, description, status, remarks, created_on)
        values (?, ?, null, ?, ?, ?, ?, ?, ?)
        """, id, customerId, title, department, description, status, remarks, Date.valueOf(LocalDate.now().minusDays(daysAgo)));
  }

  private UserView toUserView(Customer customer, String role) {
    return new UserView(customer.id, customer.name, customer.email, role, customer.id);
  }

  private void validateCustomerRequest(AdminCustomerRequest request) {
    validateCustomerProfile(request.name(), request.email(), request.address(), request.mobile());
    if (!STRONG_PASSWORD.matcher(request.password()).matches()) {
      throw new IllegalArgumentException("Password needs uppercase, lowercase, number, special character, and minimum 8 characters");
    }
  }

  private void validateCustomerProfile(String name, String email, String address, String mobile) {
    if (!NAME.matcher(name.trim()).matches()) {
      throw new IllegalArgumentException("Customer name should contain only characters and be under 50 characters");
    }
    if (!MOBILE.matcher(mobile).matches()) {
      throw new IllegalArgumentException("Mobile number must contain 10 digits");
    }
    if (address != null && !address.isBlank() && address.trim().length() < 8) {
      throw new IllegalArgumentException("Address should be at least 8 characters long");
    }
  }

  private void validateBillRequest(BillRequest request) {
    var customer = requireCustomer(request.customerId());
    if (!customer.consumerNumbers.contains(request.consumerNumber())) {
      throw new IllegalArgumentException("Consumer number does not belong to this customer");
    }
    if (request.units() <= 0) {
      throw new IllegalArgumentException("Units must be greater than zero");
    }
    if (request.amount().compareTo(BigDecimal.ZERO) <= 0 || request.amount().compareTo(MAX_BILL_AMOUNT) > 0) {
      throw new IllegalArgumentException("Bill amount must be between 1 and 5000");
    }
    var today = LocalDate.now();
    if (request.dueDate().isAfter(today) || request.dueDate().isBefore(today.minusMonths(1))) {
      throw new IllegalArgumentException("Bill date must be within the last one month and cannot be future dated");
    }
    var month = normalizedMonth(request.month());
    if (exists("select count(*) from bills where consumer_number = ? and lower(billing_month) = lower(?)", request.consumerNumber(), month)) {
      throw new IllegalArgumentException("This consumer already has a bill for this month");
    }
  }

  private String normalizedMonth(String value) {
    try {
      return YearMonth.parse(value.trim(), BILLING_MONTH).format(BILLING_MONTH);
    } catch (DateTimeParseException exception) {
      throw new IllegalArgumentException("Billing month must be like May 2026");
    }
  }

  private String generateConsumerNumber(long customerId, int sequence) {
    return String.format("%09d%04d", customerId, sequence);
  }

  private boolean hasUnpaidBills(long customerId) {
    return exists("select count(*) from bills where customer_id = ? and upper(status) = 'UNPAID'", customerId);
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
