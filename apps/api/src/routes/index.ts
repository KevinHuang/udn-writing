import Router from '@koa/router';
import userRouter from './user';
import studRouter from './student';
import geminiRouter from './geminiService';
import instructorRouter from './instructor';
import adminRouter from './admin';
import taskRouter from './task';
import semesterRouter from './semester';
import courseRouter from './course';
import portfolioRouter from './portfolio';


const router = new Router();

// router.prefix('/private');

router.use(userRouter.routes());
router.use(studRouter.routes());
router.use(geminiRouter.routes());
router.use('/instructor', instructorRouter.routes());
router.use(adminRouter.routes());
router.use('/task', taskRouter.routes());
router.use(semesterRouter.routes());
router.use(courseRouter.routes());
// 數位作品集專用資料介面。用 1Campus token 驗證，不走 session（見 routes/portfolio.ts）
router.use(portfolioRouter.routes());

const serviceRouter = new Router();
serviceRouter.use('/service', router.routes());
serviceRouter.use('/service', router.allowedMethods());

export default serviceRouter;
