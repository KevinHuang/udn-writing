import Router from '@koa/router';
import userRouter from './user';
import studRouter from './student';
import geminiRouter from './geminiService';
import instructorRouter from './instructor';
import adminRouter from './admin';
import taskRouter from './task';


const router = new Router();

// router.prefix('/private');

router.use(userRouter.routes());
router.use(studRouter.routes());
router.use(geminiRouter.routes());
router.use('/instructor', instructorRouter.routes());
router.use(adminRouter.routes());
router.use('/task', taskRouter.routes());

const serviceRouter = new Router();
serviceRouter.use('/service', router.routes());
serviceRouter.use('/service', router.allowedMethods());

export default serviceRouter;
