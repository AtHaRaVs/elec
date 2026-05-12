package com.example.ebilling;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

class Customer {
  public long id;
  public String name;
  public String email;
  public List<String> consumerNumbers;
  public String connectionStatus;
  public String address;
  public String mobile;
  public String customerType;
  public String electricalSection;

  Customer(long id, String name, String email, List<String> consumerNumbers, String connectionStatus, String address, String mobile, String customerType, String electricalSection) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.consumerNumbers = new ArrayList<>(consumerNumbers);
    this.connectionStatus = connectionStatus;
    this.address = address;
    this.mobile = mobile;
    this.customerType = customerType;
    this.electricalSection = electricalSection;
  }
}

class Bill {
  public long id;
  public long customerId;
  public String consumerNumber;
  public String month;
  public int units;
  public BigDecimal amount;
  public LocalDate dueDate;
  public String status;

  Bill(long id, long customerId, String consumerNumber, String month, int units, BigDecimal amount, LocalDate dueDate, String status) {
    this.id = id;
    this.customerId = customerId;
    this.consumerNumber = consumerNumber;
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
  public Long billId;
  public String title;
  public String department;
  public String description;
  public String status;
  public String remarks;
  public LocalDate createdOn;

  Complaint(long id, long customerId, Long billId, String title, String department, String description, String status, String remarks, LocalDate createdOn) {
    this.id = id;
    this.customerId = customerId;
    this.billId = billId;
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
record RegisterRequest(@NotBlank String name, @Email String email, @NotBlank String password, @NotBlank String address, @NotBlank String mobile, @NotBlank String customerType, @NotBlank String electricalSection) {}
record LoginRequest(@Email String email, @NotBlank String password, @NotBlank String role) {}
record PayRequest(@NotBlank String cardLast4) {}
record ComplaintRequest(@NotBlank String title, @NotBlank String department, @NotBlank String description, Long billId) {}
record ComplaintUpdateRequest(@NotBlank String status, String remarks) {}
record AdminCustomerRequest(@NotBlank String name, @Email String email, @NotBlank String password, @NotBlank String address, @NotBlank String mobile, @NotBlank String customerType, @NotBlank String electricalSection) {}
record UpdateCustomerRequest(@NotBlank String name, @Email String email, @NotBlank String address, @NotBlank String mobile, @NotBlank String customerType, @NotBlank String electricalSection) {}
record ConnectionRequest(@NotBlank String connectionStatus) {}
record ProfileRequest(@NotBlank String name, @Email String email, String address, String mobile, String customerType, String electricalSection) {}
record BillRequest(@NotNull Long customerId, @NotBlank String consumerNumber, @NotBlank String month, int units, @NotNull BigDecimal amount, @NotNull LocalDate dueDate) {}
record BulkBillRequest(@NotNull List<Long> customerIds, @NotBlank String month, int units, @NotNull BigDecimal amount, @NotNull LocalDate dueDate) {}
