# Electricity Billing & Complaint Portal

Simple full-stack application for the sprint requirement:

- Angular frontend
- Spring Boot backend
- Customer, Admin, and SME roles
- SQL persistence using an embedded H2 database, so no separate database setup is needed

## Features

### Customer

- Register using consumer number
- Login and view home summary
- View outstanding and paid bills
- Download bill details
- Pay bills using card last 4 digits
- Download payment details
- Register complaints
- View complaint status with filters

### Admin

- Add, update, search, and list customers
- View full customer details including customer ID, address, mobile, customer type, electrical section, connection status, and all linked consumer numbers
- Add consumer numbers for existing customers
- Filter customers by electrical section and customer type
- Disconnect or reconnect customers
- Delete customers with confirmation
- Add bill for a customer
- Bulk upload bills for multiple customers
- View and filter complaints
- Update complaint status with remarks

### SME

- List complaints
- Search complaint by consumer number
- Filter complaints by status
- Update complaint status with remarks

## Demo Login

| Role | Email | Password |
| --- | --- | --- |
| Customer | customer@demo.com | customer123 |
| Admin | admin@demo.com | admin123 |
| SME | sme@demo.com | sme123 |

## Run Backend

Install Maven if it is not already installed, then run:

```bash
cd backend
mvn spring-boot:run
```

Backend runs on:

```text
http://localhost:8080
```

H2 database console:

```text
http://localhost:8080/h2-console
JDBC URL: jdbc:h2:file:./data/ebilling-db
User: sa
Password: <blank>
```

## Run Frontend

```bash
cd frontend
npm install
npm start
```

Frontend runs on:

```text
http://localhost:4200
```

## Project Structure

```text
backend/
  pom.xml
  src/main/java/com/example/ebilling/EbillingApplication.java
frontend/
  package.json
  src/app/app.component.ts
  src/app/app.component.html
  src/app/app.component.css
```

## Explanation Document

For viva/teacher questions, see:

```text
PROJECT_EXPLANATION.md
```
