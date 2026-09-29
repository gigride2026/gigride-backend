const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/auth.cjs");
const { requireStaff } = require("../middlewares/staffAuth.cjs");

// Every Support Center endpoint must pass both authentication
// and GigRide staff authorization.
router.use(authMiddleware, requireStaff);

router.get("/me", (req, res) => {
  return res.json({
    ok: true,
    user_id: req.user.id,
    staff_role: req.staffProfile.staff_role,
  });
});

module.exports = router;
